import {
  editor,
  index,
  lua,
  mq,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { base64Decode, hashSHA256 } from "../../plug-api/lib/crypto.ts";
import type { YamlPatch } from "../../plug-api/lib/yaml.ts";

const LIBRARY_TAG = "meta/library";
const REMOTE_LIBRARY_TAG = "meta/library/remote";
const REPOSITORY_TAG = "meta/repository";
const REPOSITORY_PREFIX = "Repositories/";
const STD_REPO_NAME = "Repositories/Std";

export type InstalledLibrary = {
  name: string;
  uri?: string;
  hash?: string;
  mode?: "pull" | "push" | "sync";
  files?: string[];
};

export type InstallableLibrary = {
  name: string;
  page: string;
  uri: string;
  description?: string;
  website?: string;
  repositoryPage?: string;
};

export type RepositoryInfo = {
  name: string;
  uri?: string;
  mode?: "pull" | "push" | "sync";
  hash?: string;
};

export type RoguePlug = {
  path: string;
};

export type LibrariesViewModel = {
  installed: InstalledLibrary[];
  installable: InstallableLibrary[];
  repositories: RepositoryInfo[];
  roguePlugs: RoguePlug[];
};

type ShareMode = "pull" | "push" | "sync";
type ShareMeta = { uri?: string; hash?: string; mode?: ShareMode };

// ---------- Listing ----------

export async function listLibraries(): Promise<LibrariesViewModel> {
  const [installedRaw, installableRaw, repositoriesRaw, allPlugs] =
    await Promise.all([
      index.queryLuaObjects<any>(LIBRARY_TAG, {}),
      index.queryLuaObjects<any>(REMOTE_LIBRARY_TAG, {}),
      index.queryLuaObjects<any>(REPOSITORY_TAG, {}),
      space.listPlugs(),
    ]);

  const installed: InstalledLibrary[] = installedRaw.map((lib: any) => ({
    name: lib.name,
    uri: lib.share?.uri,
    hash: lib.share?.hash,
    mode: lib.share?.mode,
    files: lib.files,
  }));

  const installedUris = new Set(
    installed.map((l) => l.uri).filter((u): u is string => !!u),
  );

  const installable: InstallableLibrary[] = installableRaw
    .filter((lib: any) => lib.uri && !installedUris.has(lib.uri))
    .map((lib: any) => ({
      name: lib.name,
      page: lib.page,
      uri: lib.uri,
      description: lib.description,
      website: lib.website,
      repositoryPage: lib.page,
    }));

  const repositories: RepositoryInfo[] = repositoriesRaw.map((r: any) => ({
    name: r.name,
    uri: r.share?.uri,
    hash: r.share?.hash,
    mode: r.share?.mode,
  }));

  const ownedPlugs = new Set<string>();
  for (const lib of installedRaw) {
    const base = urlDir(lib.name);
    const files: string[] = Array.isArray(lib.files) ? lib.files : [];
    for (const f of files) {
      if (typeof f === "string" && f.endsWith(".plug.js")) {
        ownedPlugs.add(base + f);
      }
    }
  }
  const roguePlugs: RoguePlug[] = (allPlugs ?? [])
    .filter((f: any) => f.perm !== "ro" && !ownedPlugs.has(f.name))
    .map((f: any) => ({ path: f.name as string }));

  return { installed, installable, repositories, roguePlugs };
}

// ---------- URI fetching (bridged to net.* via Lua) ----------

async function readUriAsText(uri: string): Promise<string> {
  const expr = `net.readURI(${luaString(uri)}, {encoding="text/markdown"})`;
  const result = await lua.evalExpression(expr);
  if (typeof result !== "string") {
    throw new Error(`Could not fetch ${uri}`);
  }
  return result;
}

async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  // Ask Lua for octet-stream, then base64-encode so binary travels cleanly.
  const expr = `encoding.base64Encode(net.readURI(${luaString(uri)}, {encoding="application/octet-stream"}))`;
  const b64 = await lua.evalExpression(expr);
  if (typeof b64 !== "string") {
    throw new Error(`Could not fetch ${uri}`);
  }
  return base64Decode(b64);
}

function luaString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ---------- Hashing (parity with share.contentHash) ----------

// share.contentHash strips share.{uri,hash,mode} from frontmatter, then takes
// the first 8 hex chars of sha256. We mirror that exactly so existing page
// hashes compare equal to our recomputed ones.
async function contentHash(text: string): Promise<string> {
  const cleaned = await cleanFrontmatter(text);
  const hex = await hashSHA256(cleaned);
  return hex.slice(0, 8);
}

async function cleanFrontmatter(text: string): Promise<string> {
  const patches: YamlPatch[] = [
    { op: "delete-key", path: "share.uri" },
    { op: "delete-key", path: "share.hash" },
    { op: "delete-key", path: "share.mode" },
  ];
  return await system.invokeFunction("index.patchFrontmatter", text, patches);
}

async function setShareFrontmatter(
  text: string,
  meta: ShareMeta,
): Promise<string> {
  const patches: YamlPatch[] = [
    { op: "set-key", path: "share.uri", value: meta.uri },
    { op: "set-key", path: "share.hash", value: meta.hash },
    { op: "set-key", path: "share.mode", value: meta.mode },
  ];
  return await system.invokeFunction("index.patchFrontmatter", text, patches);
}

async function extractFrontmatter(
  text: string,
): Promise<{ frontmatter: any; text: string }> {
  return await system.invokeFunction("index.extractFrontmatter", text);
}

// ---------- Utility ----------

function urlDir(url: string): string {
  const m = url.match(/^(.*\/)[^/]+$/);
  return m ? m[1] : url;
}

export function suggestRepoNameFromUri(uri: string): string {
  // Port of library.suggestRepoNameFromUri from the deleted Library.md.
  const parts = uri.split(":");
  let name = parts[parts.length - 1];
  const strip = [".md", "/REPO", "/main", "/blob", "/silverbullet-libraries"];
  for (const s of strip) {
    if (name.endsWith(s)) name = name.slice(0, -s.length);
  }
  // Strip branch names like @main
  name = name.replace(/@.+$/, "");
  const segs = name.split("/");
  return segs[segs.length - 1] || name;
}

// ---------- Library install / update / remove ----------

// Install or update a library from a URI. If `currentHash` is provided and
// matches the remote hash, returns null (no-op). On success returns the
// page name that was written and any plug file paths to hot-load.
async function installLibrary(
  uri: string,
  opts: { currentHash?: string; allowOverwrite?: boolean } = {},
): Promise<{ page: string; plugPaths: string[] } | null> {
  const text = await readUriAsText(uri);
  const { frontmatter: remoteFm } = await extractFrontmatter(text);
  if (!remoteFm || !remoteFm.name) {
    throw new Error("Library frontmatter missing required 'name'");
  }
  const remoteHash = await contentHash(text);
  if (opts.currentHash && opts.currentHash === remoteHash) {
    return null;
  }

  const pageName: string = remoteFm.name;

  if (!opts.allowOverwrite && (await space.pageExists(pageName))) {
    throw new Error(`Page already exists: ${pageName}`);
  }

  const sourceBase = urlDir(uri);
  const targetBase = urlDir(pageName);

  const stamped = await setShareFrontmatter(text, {
    uri,
    hash: remoteHash,
    mode: "pull",
  });

  await space.writePage(pageName, stamped);

  const files: string[] = Array.isArray(remoteFm.files)
    ? remoteFm.files.filter((f: unknown): f is string => typeof f === "string")
    : [];
  await Promise.all(
    files.map(async (file) => {
      const data = await readUriAsBytes(sourceBase + file);
      await space.writeFile(targetBase + file, data);
    }),
  );
  const plugPaths = files
    .filter((f) => f.endsWith(".plug.js"))
    .map((f) => targetBase + f);

  return { page: pageName, plugPaths };
}

async function hotLoadPlugs(plugPaths: string[]): Promise<void> {
  for (const p of plugPaths) {
    try {
      await system.loadPlug(p);
    } catch (e: any) {
      console.warn(`Failed to hot-load plug ${p}:`, e?.message || e);
    }
  }
}

async function updateLibrary(
  name: string,
  force: boolean,
): Promise<{ changed: boolean; plugPaths: string[] }> {
  const text = await space.readPage(name);
  const { frontmatter: fm } = await extractFrontmatter(text);
  const share = fm?.share as ShareMeta | undefined;
  if (!share?.uri) {
    throw new Error(`No share metadata on ${name}`);
  }
  const result = await installLibrary(share.uri, {
    currentHash: force ? undefined : share.hash,
    allowOverwrite: true,
  });
  return { changed: result !== null, plugPaths: result?.plugPaths ?? [] };
}

async function removeLibrary(name: string): Promise<void> {
  const text = await space.readPage(name);
  if (!text) throw new Error(`Could not read ${name}`);
  const { frontmatter: fm } = await extractFrontmatter(text);
  const targetBase = urlDir(name);
  const files: string[] = Array.isArray(fm?.files)
    ? fm.files.filter((f: unknown): f is string => typeof f === "string")
    : [];
  await Promise.all(
    files.map(async (file) => {
      const target = targetBase + file;
      if (file.endsWith(".plug.js")) {
        try {
          await system.unloadPlug(target);
        } catch (e: any) {
          console.warn(`Failed to unload plug ${target}:`, e?.message || e);
        }
      }
      try {
        await space.deleteFile(target);
      } catch {
        // best-effort; asset may already be gone
      }
    }),
  );
  await space.deletePage(name);
}

// ---------- Repository add / update / remove ----------

async function addRepository(uri: string, targetPage: string): Promise<string> {
  if (await space.pageExists(targetPage)) {
    throw new Error(`${targetPage} already exists`);
  }
  const text = await readUriAsText(uri);
  const hash = await contentHash(text);
  const stamped = await setShareFrontmatter(text, {
    uri,
    hash,
    mode: "pull",
  });
  await space.writePage(targetPage, stamped);
  return targetPage;
}

async function updateRepository(name: string): Promise<boolean> {
  // Delegate to share.sharePage which handles all modes generically.
  const expr = `share.sharePage(${luaString(name)})`;
  const result = await lua.evalExpression(expr);
  return !!result;
}

async function removeRepository(name: string): Promise<void> {
  await space.deletePage(name);
}

// ---------- Reload coordination ----------

async function reloadEverything(): Promise<void> {
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadConfigAndCommands();
  // codeWidget.refreshAll equivalent not needed here; the modal closes anyway.
}

// ---------- Dispatcher exposed to UI ----------

type ActionResult<T = any> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function librariesAction(
  kind: string,
  args: any,
): Promise<ActionResult> {
  try {
    switch (kind) {
      case "install": {
        const result = await installLibrary(args.uri, {});
        if (result) await hotLoadPlugs(result.plugPaths);
        await reloadEverything();
        return { ok: true, data: { page: result?.page } };
      }
      case "update": {
        const { changed, plugPaths } = await updateLibrary(
          args.name,
          !!args.force,
        );
        if (changed) {
          await hotLoadPlugs(plugPaths);
          await reloadEverything();
        }
        return { ok: true, data: { changed } };
      }
      case "remove": {
        await removeLibrary(args.name);
        await reloadEverything();
        return { ok: true };
      }
      case "installPlug": {
        const path: string = args.path;
        if (!path.endsWith(".plug.js")) {
          throw new Error("Plug path must end with .plug.js");
        }
        const data = await readUriAsBytes(args.uri);
        await space.writeFile(path, data);
        await hotLoadPlugs([path]);
        await reloadEverything();
        return { ok: true, data: { path } };
      }
      case "removePlug": {
        try {
          await system.unloadPlug(args.path);
        } catch (e: any) {
          console.warn(`Failed to unload plug ${args.path}:`, e?.message || e);
        }
        await space.deleteFile(args.path);
        await reloadEverything();
        return { ok: true };
      }
      case "updateAll": {
        const { installed } = await listLibraries();
        const updates: string[] = [];
        const allPlugPaths: string[] = [];
        for (const lib of installed) {
          if (lib.mode !== "pull" || !lib.uri) continue;
          try {
            const r = await updateLibrary(lib.name, false);
            if (r.changed) {
              updates.push(lib.name);
              allPlugPaths.push(...r.plugPaths);
            }
          } catch (e: any) {
            console.warn(`Update failed for ${lib.name}:`, e.message);
          }
        }
        await hotLoadPlugs(allPlugPaths);
        await reloadEverything();
        return { ok: true, data: { updated: updates } };
      }
      case "addRepository": {
        const page = await addRepository(args.uri, args.page);
        await reloadEverything();
        return { ok: true, data: { page } };
      }
      case "updateRepository": {
        const changed = await updateRepository(args.name);
        if (changed) await reloadEverything();
        return { ok: true, data: { changed } };
      }
      case "removeRepository": {
        await removeRepository(args.name);
        await reloadEverything();
        return { ok: true };
      }
      case "updateAllRepositories": {
        const { repositories } = await listLibraries();
        const updates: string[] = [];
        for (const r of repositories) {
          try {
            const changed = await updateRepository(r.name);
            if (changed) updates.push(r.name);
          } catch (e: any) {
            console.warn(`Repo update failed for ${r.name}:`, e.message);
          }
        }
        await reloadEverything();
        return { ok: true, data: { updated: updates } };
      }
      default:
        return { ok: false, error: `Unknown action: ${kind}` };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function librariesRefresh(): Promise<LibrariesViewModel> {
  return await listLibraries();
}

// Exported so the UI can render "Recommended" section pinned on top.
export const STD_REPOSITORY = STD_REPO_NAME;
export const REPOSITORY_PAGE_PREFIX = REPOSITORY_PREFIX;
