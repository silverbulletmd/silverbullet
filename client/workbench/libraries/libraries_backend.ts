import {
  editor,
  index,
  lua,
  mq,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { base64Decode } from "../../../plug-api/lib/crypto.ts";
import { stdLibPrefix } from "../../spaces/constants.ts";
import { luaString } from "../shared/lua_string.ts";

// What the Libraries tab does to the space. Pulls go through the share core
// in Lua (share.install, share.sharePage, share.check), which keeps this
// device's record of what it last pulled; this file adds what only
// libraries have: their files and plugs.

const LIBRARY_TAG = "meta/library";
const REMOTE_LIBRARY_TAG = "meta/library/remote";
const REPOSITORY_TAG = "meta/repository";

export type ShareMode = "pull" | "push" | "sync";

export type InstalledLibrary = {
  name: string;
  uri?: string;
  mode?: ShareMode;
  files?: string[];
};

export type InstallableLibrary = {
  name: string;
  uri: string;
  description?: string;
  website?: string;
  repositoryPage?: string;
};

export type RepositoryInfo = {
  name: string;
  uri?: string;
  mode?: ShareMode;
};

export type LibraryCheck = {
  state:
    | "upToDate"
    | "localChanged"
    | "remoteChanged"
    | "bothChanged"
    | "differs"
    | "missing"
    | "error";
  error?: string;
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

/** Built in: served by SilverBullet itself, never updated or removed here. */
export const isBuiltinLibrary = (l: InstalledLibrary) =>
  l.name.startsWith(stdLibPrefix) || !l.uri;

/** Installed from a remote, so Update, Update all and Check for updates apply. */
export const isUpdatable = (l: InstalledLibrary) =>
  !isBuiltinLibrary(l) && l.mode === "pull";

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
      uri: lib.uri,
      description: lib.description,
      website: lib.website,
      repositoryPage: lib.page,
    }));

  const repositories: RepositoryInfo[] = repositoriesRaw.map((r: any) => ({
    name: r.name,
    uri: r.share?.uri,
    mode: r.share?.mode,
  }));

  const ownedPlugs = new Set<string>();
  for (const lib of installed) {
    const base = urlDir(lib.name);
    for (const f of stringsOf(lib.files)) {
      if (f.endsWith(".plug.js")) ownedPlugs.add(base + f);
    }
  }
  const roguePlugs: RoguePlug[] = (allPlugs ?? [])
    .filter((f: any) => f.perm !== "ro" && !ownedPlugs.has(f.name))
    .map((f: any) => ({ path: f.name as string }));

  return { installed, installable, repositories, roguePlugs };
}

type InstallOptions = { page?: string; installed?: string; force?: boolean };

async function shareInstall(
  uri: string,
  opts: InstallOptions,
): Promise<{ page: string; files?: unknown; changed: boolean }> {
  const fields = [
    opts.page !== undefined && `page = ${luaString(opts.page)}`,
    opts.installed !== undefined && `installed = ${luaString(opts.installed)}`,
    opts.force && "force = true",
  ].filter(Boolean);
  return await lua.evalExpression(
    `share.install(${luaString(uri)}, {${fields.join(", ")}})`,
  );
}

async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  // Base64 so binary travels cleanly
  const b64 = await lua.evalExpression(
    `encoding.base64Encode(net.readURI(${luaString(uri)}, {encoding="application/octet-stream"}))`,
  );
  if (typeof b64 !== "string") {
    throw new Error(`Could not fetch ${uri}`);
  }
  return base64Decode(b64);
}

function urlDir(url: string): string {
  const m = url.match(/^(.*\/)[^/]+$/);
  return m ? m[1] : url;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((f): f is string => typeof f === "string")
    : [];
}

/** Lets the index catch up, then picks up new scripts, commands and config. */
async function reloadEverything(): Promise<void> {
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadConfigAndCommands();
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

async function unloadPlug(path: string): Promise<void> {
  try {
    await system.unloadPlug(path);
  } catch (e: any) {
    console.warn(`Failed to unload plug ${path}:`, e?.message || e);
  }
}

/**
 * Pulls a library page and, when it was written, the files it lists next to
 * it; plugs among them are loaded.
 */
async function pullLibrary(
  uri: string,
  opts: InstallOptions,
): Promise<{ page: string; changed: boolean }> {
  const result = await shareInstall(uri, opts);
  if (!result.changed) return result;
  const sourceBase = urlDir(uri);
  const targetBase = urlDir(result.page);
  const files = stringsOf(result.files);
  await Promise.all(
    files.map(async (file) => {
      const data = await readUriAsBytes(sourceBase + file);
      await space.writeFile(targetBase + file, data);
    }),
  );
  await hotLoadPlugs(
    files.filter((f) => f.endsWith(".plug.js")).map((f) => targetBase + f),
  );
  return result;
}

export async function installLibrary(uri: string): Promise<{ page: string }> {
  const { page } = await pullLibrary(uri, {});
  await reloadEverything();
  return { page };
}

/**
 * Updates an installed library when its remote changed since it was
 * installed here; force reinstalls it regardless, dropping local edits.
 */
export async function updateLibrary(
  lib: { name: string; uri: string },
  force = false,
): Promise<{ changed: boolean }> {
  const { changed } = await pullLibrary(lib.uri, {
    installed: lib.name,
    force,
  });
  if (changed) await reloadEverything();
  return { changed };
}

export async function removeLibrary(name: string): Promise<void> {
  const text = await space.readPage(name);
  if (!text) throw new Error(`Could not read ${name}`);
  const { frontmatter } = await system.invokeFunction(
    "index.extractFrontmatter",
    text,
  );
  const targetBase = urlDir(name);
  await Promise.all(
    stringsOf(frontmatter?.files).map(async (file) => {
      const target = targetBase + file;
      if (file.endsWith(".plug.js")) await unloadPlug(target);
      try {
        await space.deleteFile(target);
      } catch {
        // best-effort; asset may already be gone
      }
    }),
  );
  await space.deletePage(name);
  await reloadEverything();
}

export async function installPlug(uri: string, path: string): Promise<void> {
  if (!path.endsWith(".plug.js")) {
    throw new Error("Plug path must end with .plug.js");
  }
  await space.writeFile(path, await readUriAsBytes(uri));
  await hotLoadPlugs([path]);
  await reloadEverything();
}

export async function removePlug(path: string): Promise<void> {
  await unloadPlug(path);
  await space.deleteFile(path);
  await reloadEverything();
}

export async function addRepository(uri: string, page: string): Promise<void> {
  await shareInstall(uri, { page });
  await reloadEverything();
}

export async function updateRepository(
  name: string,
): Promise<{ changed: boolean }> {
  const changed = !!(await lua.evalExpression(
    `share.sharePage(${luaString(name)})`,
  ));
  if (changed) await reloadEverything();
  return { changed };
}

/**
 * Updates every repository with a source; one failing doesn't stop the
 * others. Says which changed, and why the failing ones did.
 */
export async function updateAllRepositories(): Promise<{
  updated: string[];
  errors: string[];
}> {
  const names = (await listLibraries()).repositories
    .filter((r) => r.uri)
    .map((r) => r.name);
  const results: Record<
    string,
    { ok: boolean; result?: boolean; error?: string }
  > =
    (await lua.evalExpression(
      `share.shareMany({${names.map(luaString).join(", ")}})`,
    )) ?? {};
  const updated: string[] = [];
  const errors: string[] = [];
  for (const name of names) {
    const r = results[name];
    if (r?.ok && r.result) updated.push(name);
    else if (r && !r.ok) errors.push(`${name}: ${r.error}`);
  }
  await reloadEverything();
  return { updated, errors };
}

export async function removeRepository(name: string): Promise<void> {
  await space.deletePage(name);
  await reloadEverything();
}

// Remote reads for Check for updates that run side by side
const CHECK_CONCURRENCY = 6;

/** Reads every installed library's and repository's remote once; never writes. */
export async function checkUpdates(): Promise<Record<string, LibraryCheck>> {
  const { installed, repositories } = await listLibraries();
  const queue = [
    ...installed.filter(isUpdatable).map((l) => l.name),
    ...repositories.filter((r) => r.uri).map((r) => r.name),
  ];
  const checks: Record<string, LibraryCheck> = {};
  const worker = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      Object.assign(
        checks,
        await lua.evalExpression(`share.check({${luaString(name)}})`),
      );
    }
  };
  await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));
  return checks;
}
