import {
  encodePageURI,
  type Path,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import { fileName } from "@silverbulletmd/silverbullet/lib/resolve";
import {
  BasenameIndex,
  type PathLookup,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import type {
  DocumentMeta,
  FileMeta,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type {
  FileRevisions,
  SpaceLog,
} from "@silverbulletmd/silverbullet/type/revisions";
import type { Client } from "../../client.ts";
import { fsEndpoint } from "../../spaces/constants.ts";
import type { SysCallMapping } from "../system.ts";

function revisionsUrl(client: Client, suffix: string): string {
  return `${client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length)}/.revisions/${suffix}`;
}

async function fetchRevisionsJson(
  client: Client,
  suffix: string,
): Promise<any> {
  const resp = await client.httpSpacePrimitives.authenticatedFetch(
    revisionsUrl(client, suffix),
    { method: "GET", headers: { Accept: "application/json" } },
  );
  if (resp.status === 404) {
    throw Object.assign(
      new Error("Revisions are not available for this space"),
      { status: resp.status },
    );
  }
  if (!resp.ok) {
    throw Object.assign(new Error(`Revisions request failed: ${resp.status}`), {
      status: resp.status,
    });
  }
  return resp.json();
}

/**
 * The index resolution syscalls answer from. The client's own index is only
 * trustworthy once the file list has loaded; before that, ask the space
 * directly rather than reporting everything as missing.
 */
async function resolutionIndex(client: Client): Promise<BasenameIndex> {
  if (client.clientSystem.knownFilesLoaded) {
    return client.clientSystem.allKnownFiles;
  }
  const listing = new BasenameIndex();
  listing.rebuild(
    (await client.space.spacePrimitives.fetchFileList()).map((f) => f.name),
  );
  return listing;
}

export function spaceReadSyscalls(client: Client): SysCallMapping {
  return {
    "space.listPages": {
      callback: (): Promise<PageMeta[]> => client.space.fetchPageList(),
      description: "Lists all pages in the space.",
    },
    "space.readPage": {
      callback: async (_ctx, name: string): Promise<string> =>
        (await client.space.readPage(name)).text,
      description: "Reads a page and returns its Markdown text.",
      signatures: ["space.readPage(name)"],
    },
    "space.readPageWithMeta": {
      callback: (
        _ctx,
        name: string,
      ): Promise<{ text: string; meta: PageMeta }> =>
        client.space.readPage(name),
      description:
        "Reads a page and returns both its Markdown text and metadata.",
      signatures: ["space.readPageWithMeta(name)"],
    },
    "space.readRef": {
      callback: async (_ctx, ref: string | Ref): Promise<string> => {
        if (typeof ref === "string") {
          ref = parseToRef(ref)!;
          if (!ref) {
            throw new Error(`Invalid ref: ${ref}`);
          }
        }
        return (await client.space.readRef(ref)).text;
      },
      description:
        "Reads the text addressed by a page, header, or position reference.",
      signatures: ["space.readRef(ref)"],
    },
    "space.pageExists": {
      callback: (_ctx, name: string): boolean =>
        resolvePath(`${name}.md`, "", client.clientSystem.allKnownFiles).exists,
      description: "Checks whether a page exists in the space.",
      signatures: ["space.pageExists(name)"],
    },
    "space.getPageMeta": {
      callback: (_ctx, name: string): Promise<PageMeta> =>
        client.space.getPageMeta(name),
      description: "Returns metadata for a page.",
      signatures: ["space.getPageMeta(name)"],
    },
    "space.listPlugs": {
      callback: (): Promise<FileMeta[]> => client.space.listPlugs(),
      description: "Lists all plug files in the space.",
    },
    "space.listDocuments": {
      callback: async (): Promise<DocumentMeta[]> =>
        await client.space.fetchDocumentList(),
      description: "Lists all non-page documents in the space.",
    },
    "space.readDocument": {
      callback: async (_ctx, name: string): Promise<Uint8Array> =>
        (await client.space.readDocument(name)).data,
      description: "Reads a document as binary data.",
      signatures: ["space.readDocument(name)"],
    },
    "space.getDocumentMeta": {
      callback: async (_ctx, name: string): Promise<DocumentMeta> =>
        await client.space.getDocumentMeta(name),
      description: "Returns metadata for a document.",
      signatures: ["space.getDocumentMeta(name)"],
    },
    // DEPRECATED, please use document versions instead, left here for backwards compatibility
    "space.listAttachments": {
      callback: async (): Promise<DocumentMeta[]> =>
        await client.space.fetchDocumentList(),
      description: "Deprecated alias for space.listDocuments.",
      deprecated: "Use space.listDocuments instead.",
    },
    "space.readAttachment": {
      callback: async (_ctx, name: string): Promise<Uint8Array> =>
        (await client.space.readDocument(name)).data,
      description: "Deprecated alias for space.readDocument.",
      deprecated: "Use space.readDocument instead.",
      signatures: ["space.readAttachment(name)"],
    },
    "space.getAttachmentMeta": {
      callback: async (_ctx, name: string): Promise<DocumentMeta> =>
        await client.space.getDocumentMeta(name),
      description: "Deprecated alias for space.getDocumentMeta.",
      deprecated: "Use space.getDocumentMeta instead.",
      signatures: ["space.getAttachmentMeta(name)"],
    },
    // FS
    "space.listFiles": {
      callback: (): Promise<FileMeta[]> =>
        client.space.spacePrimitives.fetchFileList(),
      description: "Lists every file in the space.",
    },
    "space.getFileMeta": {
      callback: (_ctx, name: string): Promise<FileMeta> =>
        client.space.spacePrimitives.getFileMeta(name),
      description: "Returns metadata for an arbitrary space file.",
      signatures: ["space.getFileMeta(name)"],
    },
    "space.readFile": {
      callback: async (_ctx, name: string): Promise<Uint8Array> =>
        (await client.space.spacePrimitives.readFile(name)).data,
      description: "Reads an arbitrary space file as binary data.",
      signatures: ["space.readFile(name)"],
    },
    "space.readFileWithMeta": {
      callback: async (
        _ctx,
        name: string,
      ): Promise<{ data: Uint8Array; meta: FileMeta }> =>
        await client.space.spacePrimitives.readFile(name),
      description: "Reads an arbitrary space file together with its metadata.",
      signatures: ["space.readFileWithMeta(name)"],
    },
    "space.collidingBasenames": {
      callback: async (): Promise<Record<string, Path[]>> =>
        (await resolutionIndex(client)).collidingBuckets(),
      description:
        "Returns every basename carried by more than one file, with the files carrying it.",
      signatures: ["space.collidingBasenames()"],
    },
    "space.lookupPaths": {
      callback: async (
        _ctx,
        paths: string[],
      ): Promise<Record<string, PathLookup>> => {
        const index = await resolutionIndex(client);

        const result: Record<string, PathLookup> = {};
        for (const path of paths) {
          result[path] = {
            exact: index.has(path),
            candidates: index.candidates(fileName(path)),
          };
        }
        return result;
      },
      description:
        "Looks up, for each path, whether it exists exactly and which files share its basename.",
      signatures: ["space.lookupPaths(paths)"],
    },
    "space.fileExists": {
      callback: async (_ctx, name: string): Promise<boolean> => {
        // If a full sync has successfully completed (so we know what files exist)
        // and we have a snapshot, let's use the snapshot
        if (
          client.fullSyncCompleted &&
          !client.eventedSpacePrimitives.isSnapshotEmpty()
        ) {
          return !!client.eventedSpacePrimitives.getSnapshot()[name];
        }
        try {
          await client.space.spacePrimitives.getFileMeta(name);
          // If this returned the file exists
          return true;
        } catch {
          // Assumption: any error means the file does not exist
          return false;
        }
      },
      description: "Checks whether an arbitrary file exists in the space.",
      signatures: ["space.fileExists(name)"],
    },
    // History
    "space.listRevisions": {
      callback: (_ctx, path: string, before?: string): Promise<FileRevisions> =>
        fetchRevisionsJson(
          client,
          `${encodePageURI(path)}${before ? `?before=${before}` : ""}`,
        ),
      description: "Lists the revision history of a file.",
      signatures: ["space.listRevisions(path, before?)"],
    },
    "space.getRevision": {
      callback: async (
        _ctx,
        path: string,
        rev: string,
        parent?: boolean,
      ): Promise<string> => {
        const resp = await client.httpSpacePrimitives.authenticatedFetch(
          revisionsUrl(
            client,
            `${encodePageURI(path)}?rev=${rev}${parent ? "&parent=1" : ""}`,
          ),
          { method: "GET" },
        );
        if (!resp.ok) {
          throw Object.assign(
            new Error(`Could not load revision: ${resp.status}`),
            { status: resp.status },
          );
        }
        return resp.text();
      },
      description:
        "Reads the text of a file as it was at a given revision, or at that revision's parent.",
      signatures: ["space.getRevision(path, rev, parent?)"],
    },
    "space.getRevisionDiff": {
      callback: async (_ctx, path: string, rev?: string): Promise<string> => {
        const resp = await client.httpSpacePrimitives.authenticatedFetch(
          revisionsUrl(
            client,
            `${encodePageURI(path)}?${rev ? `rev=${rev}&` : ""}format=diff`,
          ),
          { method: "GET" },
        );
        if (!resp.ok) {
          throw Object.assign(
            new Error(`Could not load revision diff: ${resp.status}`),
            { status: resp.status },
          );
        }
        return resp.text();
      },
      description:
        "Reads a unified diff of a revision's own change (vs its parent), or of the uncommitted change when no revision is given.",
      signatures: ["space.getRevisionDiff(path, rev?)"],
    },
    "space.getSpaceLog": {
      callback: (_ctx, before?: string, q?: string): Promise<SpaceLog> => {
        const params: string[] = [];
        if (before) params.push(`before=${before}`);
        if (q) params.push(`q=${encodeURIComponent(q)}`);
        return fetchRevisionsJson(
          client,
          params.length ? `?${params.join("&")}` : "",
        );
      },
      description: "Lists the space-wide commit log.",
      signatures: ["space.getSpaceLog(before?, q?)"],
    },
  };
}

export function spaceWriteSyscalls(editor: Client): SysCallMapping {
  return {
    "space.writePage": {
      callback: (_ctx, name: string, text: string): Promise<PageMeta> =>
        editor.space.writePage(name, text),
      description: "Writes Markdown text to a page and returns its metadata.",
      signatures: ["space.writePage(name, text)"],
    },
    "space.deletePage": {
      callback: async (_ctx, name: string) => {
        console.log("Deleting page");
        await editor.space.deletePage(name);
      },
      description: "Deletes a page from the space.",
      signatures: ["space.deletePage(name)"],
    },
    "space.writeDocument": {
      callback: (_ctx, name: string, data: Uint8Array): Promise<DocumentMeta> =>
        editor.space.writeDocument(name, data),
      description: "Writes binary document data and returns its metadata.",
      signatures: ["space.writeDocument(name, data)"],
    },
    "space.deleteDocument": {
      callback: async (_ctx, name: string) => {
        await editor.space.deleteDocument(name);
      },
      description: "Deletes a document from the space.",
      signatures: ["space.deleteDocument(name)"],
    },
    "space.writeFile": {
      callback: (_ctx, name: string, data: Uint8Array): Promise<FileMeta> =>
        editor.space.spacePrimitives.writeFile(name, data),
      description: "Writes an arbitrary binary file and returns its metadata.",
      signatures: ["space.writeFile(name, data)"],
    },
    "space.deleteFile": {
      callback: (_ctx, name: string) =>
        editor.space.spacePrimitives.deleteFile(name),
      description: "Deletes an arbitrary file from the space.",
      signatures: ["space.deleteFile(name)"],
    },
    "space.createRevisionSnapshot": {
      callback: async (): Promise<boolean> => {
        const resp = await editor.httpSpacePrimitives.authenticatedFetch(
          revisionsUrl(editor, ""),
          { method: "POST", headers: { Accept: "application/json" } },
        );
        if (resp.status === 404) {
          throw new Error("Revisions are not available for this space");
        }
        if (resp.status === 409) {
          throw new Error("Revisions are not managed for this space");
        }
        if (!resp.ok) {
          throw new Error(`Snapshot request failed: ${resp.status}`);
        }
        return (await resp.json()).committed === true;
      },
      description:
        "Commits everything outstanding as a revision now, rather than waiting for the automatic commit. False if there was nothing to commit.",
      signatures: ["space.createRevisionSnapshot()"],
    },
  };
}
