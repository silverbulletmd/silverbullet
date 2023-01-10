import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";
import { AttachmentMeta, FileMeta, PageMeta } from "../types.ts";
import { EventEmitter } from "../../plugos/event.ts";
import { Plug } from "../../plugos/plug.ts";
import { plugPrefix } from "./constants.ts";
import { safeRun } from "../util.ts";

const pageWatchInterval = 2000;

export type SpaceEvents = {
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: Set<PageMeta>) => void;
};

export class Space extends EventEmitter<SpaceEvents> {
  pageMetaCache = new Map<string, PageMeta>();
  watchedPages = new Set<string>();
  private initialPageListLoad = true;
  private saving = false;

  constructor(private spacePrimitives: SpacePrimitives) {
    super();
  }

  public async updatePageList() {
    const newPageList = await this.fetchPageList();
    const deletedPages = new Set<string>(this.pageMetaCache.keys());
    newPageList.forEach((meta) => {
      const pageName = meta.name;
      const oldPageMeta = this.pageMetaCache.get(pageName);
      const newPageMeta: PageMeta = { ...meta };
      if (
        !oldPageMeta &&
        (pageName.startsWith(plugPrefix) || !this.initialPageListLoad)
      ) {
        this.emit("pageCreated", newPageMeta);
      } else if (
        oldPageMeta &&
        oldPageMeta.lastModified !== newPageMeta.lastModified
      ) {
        this.emit("pageChanged", newPageMeta);
      }
      // Page found, not deleted
      deletedPages.delete(pageName);

      // Update in cache
      this.pageMetaCache.set(pageName, newPageMeta);
    });

    for (const deletedPage of deletedPages) {
      this.pageMetaCache.delete(deletedPage);
      this.emit("pageDeleted", deletedPage);
    }

    this.emit("pageListUpdated", this.listPages());
    this.initialPageListLoad = false;
  }

  watch() {
    setInterval(() => {
      safeRun(async () => {
        if (this.saving) {
          return;
        }
        for (const pageName of this.watchedPages) {
          const oldMeta = this.pageMetaCache.get(pageName);
          if (!oldMeta) {
            // No longer in cache, meaning probably deleted let's unwatch
            this.watchedPages.delete(pageName);
            continue;
          }
          // This seems weird, but simply fetching it will compare to local cache and trigger an event if necessary
          await this.getPageMeta(pageName);
        }
      });
    }, pageWatchInterval);
    this.updatePageList().catch(console.error);
  }

  async deletePage(name: string): Promise<void> {
    await this.getPageMeta(name); // Check if page exists, if not throws Error
    await this.spacePrimitives.deleteFile(`${name}.md`);

    this.pageMetaCache.delete(name);
    this.emit("pageDeleted", name);
    this.emit("pageListUpdated", new Set([...this.pageMetaCache.values()]));
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    const oldMeta = this.pageMetaCache.get(name);
    const newMeta = fileMetaToPageMeta(
      await this.spacePrimitives.getFileMeta(`${name}.md`),
    );
    if (oldMeta) {
      if (oldMeta.lastModified !== newMeta.lastModified) {
        // Changed on disk, trigger event
        this.emit("pageChanged", newMeta);
      }
    }
    return this.metaCacher(name, newMeta);
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    return this.spacePrimitives.invokeFunction(plug, env, name, args);
  }

  listPages(): Set<PageMeta> {
    return new Set(this.pageMetaCache.values());
  }

  async listPlugs(): Promise<string[]> {
    const { files } = await this.spacePrimitives.fetchFileList();
    return files
      .filter((fileMeta) => fileMeta.name.endsWith(".plug.json"))
      .map((fileMeta) => fileMeta.name);
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return this.spacePrimitives.proxySyscall(plug, name, args);
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    const pageData = await this.spacePrimitives.readFile(
      `${name}.md`,
      "string",
    );
    const previousMeta = this.pageMetaCache.get(name);
    const newMeta = fileMetaToPageMeta(pageData.meta);
    if (previousMeta) {
      if (previousMeta.lastModified !== newMeta.lastModified) {
        // Page changed since last cached metadata, trigger event
        this.emit("pageChanged", newMeta);
      }
    }
    const meta = this.metaCacher(name, newMeta);
    return {
      text: pageData.data as string,
      meta: meta,
    };
  }

  watchPage(pageName: string) {
    this.watchedPages.add(pageName);
  }

  unwatchPage(pageName: string) {
    this.watchedPages.delete(pageName);
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
  ): Promise<PageMeta> {
    try {
      this.saving = true;
      const pageMeta = fileMetaToPageMeta(
        await this.spacePrimitives.writeFile(
          `${name}.md`,
          "string",
          text,
          selfUpdate,
        ),
      );
      if (!selfUpdate) {
        this.emit("pageChanged", pageMeta);
      }
      return this.metaCacher(name, pageMeta);
    } finally {
      this.saving = false;
    }
  }

  async fetchPageList(): Promise<PageMeta[]> {
    return (await this.spacePrimitives.fetchFileList()).files
      // Filter on two criteria: not in trash and ends with .md
      .filter((fileMeta) =>
        !fileMeta.name.startsWith("_trash/") && fileMeta.name.endsWith(".md")
      )
      .map(fileMetaToPageMeta);
  }

  async fetchAttachmentList(): Promise<AttachmentMeta[]> {
    return (await this.spacePrimitives.fetchFileList()).files.filter(
      (fileMeta) =>
        !fileMeta.name.startsWith("_trash/") &&
        !fileMeta.name.endsWith(".md") &&
        !fileMeta.name.endsWith(".plug.json") &&
        fileMeta.name !== "data.db",
    );
  }

  /**
   * Reads an attachment
   * @param name path of the attachment
   * @param encoding how the return value is expected to be encoded
   * @returns
   */
  readAttachment(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: AttachmentMeta }> {
    return this.spacePrimitives.readFile(name, encoding);
  }

  getAttachmentMeta(name: string): Promise<AttachmentMeta> {
    return this.spacePrimitives.getFileMeta(name);
  }

  writeAttachment(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean | undefined,
  ): Promise<AttachmentMeta> {
    return this.spacePrimitives.writeFile(name, encoding, data, selfUpdate);
  }

  deleteAttachment(name: string): Promise<void> {
    return this.spacePrimitives.deleteFile(name);
  }

  private metaCacher(name: string, meta: PageMeta): PageMeta {
    this.pageMetaCache.set(name, meta);
    return meta;
  }
}

function fileMetaToPageMeta(fileMeta: FileMeta): PageMeta {
  return {
    ...fileMeta,
    name: fileMeta.name.substring(0, fileMeta.name.length - 3),
  } as PageMeta;
}
