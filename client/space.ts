import type { EventHook } from "./plugos/hooks/event.ts";
import { jitter, safeRun } from "@silverbulletmd/silverbullet/lib/async";
import { localDateString } from "@silverbulletmd/silverbullet/lib/dates";
import type {
  DocumentMeta,
  FileMeta,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { SpacePrimitives } from "./spaces/space_primitives.ts";
import {
  getOffsetFromLineColumn,
  getPathExtension,
  type Path,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import {
  addParentPointers,
  findNodeMatching,
  nodeAtPos,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";

const pageWatchInterval = 3000; // + jitter

/**
 * Wrapper around space primitives (see spaces/) for Client use
 * Adds:
 * - Concept of a page (on top of files)
 * - Page watchers
 */
export class Space {
  // We do watch files in the background to detect changes
  // This set of pages should only ever contain 1 page
  watchedFiles = new Set<string>();
  watchInterval?: number;

  // private initialPageListLoad = true;
  private saving = false;

  constructor(
    readonly spacePrimitives: SpacePrimitives,
    eventHook: EventHook,
  ) {
    eventHook.addLocalListener("file:deleted", (fileName: string) => {
      if (this.watchedFiles.has(fileName)) {
        this.watchedFiles.delete(fileName);
      }
    });
    setTimeout(async () => {
      // The only reason to do this is to trigger events
      await this.spacePrimitives.fetchFileList();
    });
  }

  async deletePage(name: string): Promise<void> {
    await this.getPageMeta(name); // Check if page exists, if not throws Error
    await this.spacePrimitives.deleteFile(`${name}.md`);
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    return fileMetaToPageMeta(
      await this.spacePrimitives.getFileMeta(`${name}.md`),
    );
  }

  async listPlugs(): Promise<FileMeta[]> {
    const files = await this.deduplicatedFileList();
    return files
      .filter((fileMeta) => fileMeta.name.endsWith(".plug.js"));
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    const pageData = await this.spacePrimitives.readFile(`${name}.md`);
    return {
      text: new TextDecoder().decode(pageData.data),
      meta: fileMetaToPageMeta(pageData.meta),
    };
  }

  async readRef(ref: Ref): Promise<string> {
    if (!ref.path.endsWith(".md")) {
      throw new Error("Not supported");
    }
    const name = ref.path.slice(0, -3);
    const pageText = (await this.readPage(name)).text;
    if (!ref.details) {
      return pageText;
    }
    const tree = parseMarkdown(pageText);
    addParentPointers(tree);
    if (ref.details.type === "linecolumn") {
      ref.details = {
        type: "position",
        pos: getOffsetFromLineColumn(
          pageText,
          ref.details.line,
          ref.details.column,
        ),
      };
    }
    switch (ref.details.type) {
      case "header": {
        const desiredHeaderText = ref.details.header;
        let text = `**Error:** Header not found: ${desiredHeaderText}`;
        traverseTree(tree, (n) => {
          if (n.type && n.type.startsWith("ATXHeading")) {
            const level = +n.type!.substring("ATXHeading".length);
            const headerText = renderToText(n).slice(level + 1);
            let endPos = pageText.length;
            if (headerText === desiredHeaderText) {
              // Now we have to scan for the end point
              // Let's go up one level and find either another header at this same level
              const parent = n.parent!;
              const nextHeader = findNodeMatching(
                parent,
                (h) => h.type === `ATXHeading${level}` && h.from! > n.from!,
              );
              if (nextHeader) {
                endPos = nextHeader.from!;
              }
              text = pageText.slice(n.from!, endPos);
              return true;
            }
          }
          return false;
        });
        return text;
      }
      case "position": {
        const pos = ref.details.pos;
        let n = nodeAtPos(tree, pos);
        if (!n) {
          throw new Error("No node found at position");
        }
        if (["ListMark"].includes(n.type!)) {
          n = n.parent!;
        }
        const sliceText = pageText.slice(n.from!, n.to!);

        // Determine indent level
        const targetLineIndex =
          pageText.substring(0, n.from!).split("\n").length - 1;
        const lines = pageText.split("\n");
        const targetLine = lines[targetLineIndex];
        const indent = targetLine.match(/^\s*/)![0];
        return sliceText.replaceAll(`\n${indent}`, "\n");
      }
    }
    return "";
  }

  async writePage(
    name: string,
    text: string,
  ): Promise<PageMeta> {
    try {
      this.saving = true;
      const pageMeta = fileMetaToPageMeta(
        await this.spacePrimitives.writeFile(
          `${name}.md`,
          new TextEncoder().encode(text),
        ),
      );
      // Note: we don't do very elaborate cache invalidation work here, quite quickly the cache will be flushed anyway
      return pageMeta;
    } finally {
      this.saving = false;
    }
  }

  // We're listing all pages that don't start with a _
  isListedPage(fileMeta: FileMeta): boolean {
    return fileMeta.name.endsWith(".md") && !fileMeta.name.startsWith("_");
  }

  // Checks if this a document to be listed meaning:
  // - it's not a markdown file
  // - it's not a javascript of javascript source map (.map)
  isListedDocument(fileMeta: FileMeta): boolean {
    return !this.isListedPage(fileMeta) && !fileMeta.name.endsWith(".js") &&
      !fileMeta.name.endsWith(".map");
  }

  async fetchPageList(): Promise<PageMeta[]> {
    return (await this.deduplicatedFileList())
      .filter(this.isListedPage)
      .map(fileMetaToPageMeta);
  }

  async fetchDocumentList(): Promise<DocumentMeta[]> {
    return (await this.deduplicatedFileList()).flatMap((fileMeta) =>
      this.isListedDocument(fileMeta) ? [fileMetaToDocumentMeta(fileMeta)] : []
    );
  }

  async deduplicatedFileList(): Promise<FileMeta[]> {
    const files = await this.spacePrimitives.fetchFileList();
    const fileMap = new Map<string, FileMeta>();
    for (const file of files) {
      if (fileMap.has(file.name)) {
        const existing = fileMap.get(file.name)!;
        if (existing.lastModified < file.lastModified) {
          fileMap.set(file.name, file);
        }
      } else {
        fileMap.set(file.name, file);
      }
    }
    return [...fileMap.values()];
  }

  /**
   * Reads a document
   * @param name path of the document
   * @returns
   */
  async readDocument(
    name: string,
  ): Promise<{ data: Uint8Array; meta: DocumentMeta }> {
    const file = await this.spacePrimitives.readFile(name);
    return { data: file.data, meta: fileMetaToDocumentMeta(file.meta) };
  }

  async getDocumentMeta(name: string): Promise<DocumentMeta> {
    return fileMetaToDocumentMeta(
      await this.spacePrimitives.getFileMeta(name),
    );
  }

  async writeDocument(
    name: string,
    data: Uint8Array,
  ): Promise<DocumentMeta> {
    return fileMetaToDocumentMeta(
      await this.spacePrimitives.writeFile(name, data),
    );
  }

  deleteDocument(name: string): Promise<void> {
    return this.spacePrimitives.deleteFile(name);
  }

  /**
   * Polls for changes in the watched files.
   */
  watch() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
    this.watchInterval = setInterval(() => {
      safeRun(async () => {
        if (this.saving) {
          return;
        }
        for (const fileName of this.watchedFiles) {
          // Setting observing to true here to hint that we may be interested in more active syncing
          await this.spacePrimitives.getFileMeta(fileName, true);
        }
      });
    }, pageWatchInterval + jitter());
  }

  unwatch() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
  }

  watchFile(fileName: string) {
    this.watchedFiles.add(fileName);
  }

  unwatchFile(fileName: string) {
    this.watchedFiles.delete(fileName);
  }
}

export function fileMetaToPageMeta(fileMeta: FileMeta): PageMeta {
  const name = fileMeta.name.substring(0, fileMeta.name.length - 3);
  try {
    return {
      ...fileMeta,
      ref: name,
      tag: "page",
      tags: [],
      name,
      created: localDateString(new Date(fileMeta.created)),
      lastModified: localDateString(new Date(fileMeta.lastModified)),
    } as PageMeta;
  } catch (e) {
    console.error("Failed to convert fileMeta to pageMeta", fileMeta, e);
    throw e;
  }
}

export function fileMetaToDocumentMeta(
  fileMeta: FileMeta,
): DocumentMeta {
  try {
    return {
      ...fileMeta,
      ref: fileMeta.name,
      tag: "document",
      created: localDateString(new Date(fileMeta.created)),
      lastModified: localDateString(new Date(fileMeta.lastModified)),
      // Name is always equal to the path for documents
      extension: getPathExtension(fileMeta.name as Path),
    } as DocumentMeta;
  } catch (e) {
    console.error("Failed to convert fileMeta to documentMeta", fileMeta, e);
    throw e;
  }
}
