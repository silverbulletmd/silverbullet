import {
  index,
  lua,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { base64Decode } from "../../../plug-api/lib/crypto.ts";
import { reloadConfig } from "../../config_management/reload.ts";
import { stdLibPrefix } from "../../spaces/constants.ts";
import { luaString } from "../shared/lua_string.ts";
import { errorMessage } from "../shared/value_preview.ts";
import { repositoryPage } from "./library_names.ts";
import {
  libraryLabel,
  parseRequires,
  sameLibraryUri,
} from "./library_requires.ts";

// What the Libraries tab does to the space. Pulls go through the share core
// in Lua (share.install, share.sharePage, share.check), which keeps the
// page's share.hash, its record of what was last pulled; this file adds what
// only libraries have: their files and plugs.

const LIBRARY_TAG = "meta/library";
const REMOTE_LIBRARY_TAG = "meta/library/remote";
const REPOSITORY_TAG = "meta/repository";

export type ShareMode = "pull" | "push" | "sync";

export type InstalledLibrary = {
  name: string;
  uri?: string;
  mode?: ShareMode;
  files?: string[];
  /** Full URIs of the libraries it requires */
  requires?: string[];
  /** Why `requires` entries can't be used, see {@link parseRequires} */
  requireErrors?: string[];
  /** The name a repository lists it under, such as "EB Garamond" */
  displayName?: string;
};

export type InstallableLibrary = {
  name: string;
  uri: string;
  description?: string;
  website?: string;
  repositoryPage?: string;
  /** Full URIs of the libraries it requires, as its repository lists them */
  requires?: string[];
  requireErrors?: string[];
};

export type RepositoryInfo = {
  name: string;
  uri?: string;
  mode?: ShareMode;
};

/** Update and Check for updates apply: it has a source. */
export const isUpdatableRepository = (r: RepositoryInfo): boolean => !!r.uri;

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

async function installedLibraries(): Promise<InstalledLibrary[]> {
  const raw = await index.queryLuaObjects<any>(LIBRARY_TAG, {});
  return raw.map((lib: any) => {
    const { uris, errors } = parseRequires(lib.requires, lib.share?.uri);
    return {
      name: lib.name,
      uri: lib.share?.uri,
      mode: lib.share?.mode,
      files: lib.files,
      requires: uris,
      requireErrors: errors,
    };
  });
}

export async function listLibraries(): Promise<LibrariesViewModel> {
  const [installed, installableRaw, repositoriesRaw, allPlugs] =
    await Promise.all([
      installedLibraries(),
      index.queryLuaObjects<any>(REMOTE_LIBRARY_TAG, {}),
      index.queryLuaObjects<any>(REPOSITORY_TAG, {}),
      space.listPlugs(),
    ]);

  for (const lib of installed) {
    const uri = lib.uri;
    if (!uri) continue;
    const entry = installableRaw.find(
      (r: any) => r.uri && r.name && sameLibraryUri(r.uri, uri),
    );
    if (entry) lib.displayName = entry.name;
  }

  const installedUris = new Set(
    installed.map((l) => l.uri).filter((u): u is string => !!u),
  );

  // Overlapping repositories list a library more than once
  const seenUris = new Set<string>();
  const uniqueInstallable = installableRaw.filter((lib: any) => {
    if (!lib.uri || installedUris.has(lib.uri) || seenUris.has(lib.uri)) {
      return false;
    }
    seenUris.add(lib.uri);
    return true;
  });

  const installable: InstallableLibrary[] = await Promise.all(
    uniqueInstallable.map(async (lib: any) => {
      const { uris, errors } = parseRequires(lib.requires, lib.uri);
      return {
        name: lib.name,
        uri: lib.uri,
        description: lib.description,
        website:
          lib.website ||
          ((await lua.evalExpression(`share.webUrl(${luaString(lib.uri)})`)) ??
            undefined),
        repositoryPage: lib.page,
        requires: uris,
        requireErrors: errors,
      };
    }),
  );

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

/** Writes the files a just-written library page lists next to it and loads its plugs. */
async function pullFiles(
  uri: string,
  page: string,
  files: string[],
): Promise<void> {
  const sourceBase = urlDir(uri);
  const targetBase = urlDir(page);
  await Promise.all(
    files.map(async (file) => {
      const data = await readUriAsBytes(sourceBase + file);
      await space.writeFile(targetBase + file, data);
    }),
  );
  await hotLoadPlugs(
    files.filter((f) => f.endsWith(".plug.js")).map((f) => targetBase + f),
  );
}

/** What share.libraryInfo read: see docs/API/share.md */
type LibraryInfo = {
  uri: string;
  page: string;
  files?: unknown;
  requires?: unknown;
  exists: boolean;
  text: string;
};

async function libraryInfo(uri: string): Promise<LibraryInfo> {
  return await lua.evalExpression(`share.libraryInfo(${luaString(uri)})`);
}

/** A library to pull and, for a requirement, the page that wanted it. */
type Planned = LibraryInfo & { by?: string };

const requirementError = (what: string, by: string, e: unknown) =>
  new Error(
    `Could not install ${libraryLabel(what)} (required by ${libraryLabel(by)}): ${errorMessage(e)}`,
  );

/**
 * Adds to `plan` what `requires` (of the library at `base`, page `by`) needs
 * pulled: those not installed, by URI or page name, each after its own
 * requirements. `seen` holds the URIs visited, so a cycle ends.
 */
async function planRequirements(
  requires: unknown,
  base: string,
  by: string,
  installed: InstalledLibrary[],
  seen: string[],
  plan: Planned[],
): Promise<void> {
  const { uris, errors } = parseRequires(requires, base);
  if (errors.length > 0) {
    throw new Error(`${libraryLabel(by)} requires ${errors[0]}`);
  }
  for (const uri of uris) {
    if (seen.some((s) => sameLibraryUri(s, uri))) continue;
    seen.push(uri);
    if (installed.some((l) => l.uri && sameLibraryUri(l.uri, uri))) continue;
    let info: LibraryInfo;
    try {
      info = await libraryInfo(uri);
    } catch (e) {
      throw requirementError(uri, by, e);
    }
    if (info.exists || plan.some((p) => p.page === info.page)) continue;
    await planRequirements(
      info.requires,
      uri,
      info.page,
      installed,
      seen,
      plan,
    );
    plan.push({ ...info, by });
  }
}

/**
 * Pulls the plan in order, each page then its files. One failing takes back
 * everything this run wrote, last first, and throws, naming a requirement.
 */
async function pullPlan(plan: Planned[]): Promise<void> {
  const written: Planned[] = [];
  for (const p of plan) {
    try {
      await lua.evalExpression(
        `share.installInfo({uri = ${luaString(p.uri)}, page = ${luaString(p.page)}, text = ${luaString(p.text)}})`,
      );
      written.push(p);
      await pullFiles(p.uri, p.page, stringsOf(p.files));
    } catch (e) {
      for (const w of written.reverse()) {
        await deleteLibrary(w.page, stringsOf(w.files)).catch(() => {});
      }
      throw p.by ? requirementError(p.page, p.by, e) : e;
    }
  }
}

/**
 * Installs the library at `uri`, after the libraries it requires that aren't
 * installed yet. Says which requirements it installed.
 */
export async function installLibrary(
  uri: string,
): Promise<{ page: string; requirements: string[] }> {
  const info = await libraryInfo(uri);
  if (info.exists) throw new Error(`Page already exists: ${info.page}`);
  const plan: Planned[] = [];
  await planRequirements(
    info.requires,
    uri,
    info.page,
    await installedLibraries(),
    [uri],
    plan,
  );
  const requirements = plan.map((p) => p.page);
  await pullPlan([...plan, info]);
  await reloadConfig();
  return { page: info.page, requirements };
}

async function frontmatterOf(name: string): Promise<Record<string, any>> {
  const text = await space.readPage(name);
  if (!text) throw new Error(`Could not read ${name}`);
  const { frontmatter } = await system.invokeFunction(
    "index.extractFrontmatter",
    text,
  );
  return frontmatter ?? {};
}

/** Installs what the installed library `lib` requires and isn't installed yet. */
async function installMissingRequirements(lib: {
  name: string;
  uri: string;
}): Promise<string[]> {
  const { requires } = await frontmatterOf(lib.name);
  if (!Array.isArray(requires) || requires.length === 0) return [];
  const plan: Planned[] = [];
  await planRequirements(
    requires,
    lib.uri,
    lib.name,
    await installedLibraries(),
    [lib.uri],
    plan,
  );
  await pullPlan(plan);
  return plan.map((p) => p.page);
}

/**
 * Updates an installed library when its remote changed since it was
 * installed here; force reinstalls it regardless, dropping local edits.
 */
export async function updateLibrary(
  lib: { name: string; uri: string },
  force = false,
): Promise<{ changed: boolean }> {
  const pulled = await shareInstall(lib.uri, { installed: lib.name, force });
  if (pulled.changed) {
    await pullFiles(lib.uri, pulled.page, stringsOf(pulled.files));
  }
  // What the page requires as it is now: a declined update keeps the old list
  let added: string[];
  try {
    added = await installMissingRequirements(lib);
  } catch (e) {
    if (!pulled.changed) throw e;
    await reloadConfig();
    throw new Error(
      `Updated ${libraryLabel(lib.name)}, but: ${errorMessage(e)}`,
    );
  }
  const changed = pulled.changed || added.length > 0;
  if (changed) await reloadConfig();
  return { changed };
}

/** Deletes a library page and the files it lists, unloading its plugs. */
async function deleteLibrary(name: string, files: string[]): Promise<void> {
  const targetBase = urlDir(name);
  await Promise.all(
    files.map(async (file) => {
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
}

/**
 * Removes an installed library and its files; what it requires stays
 * installed. The Libraries tab offers it only while no other installed
 * library requires it.
 */
export async function removeLibrary(name: string): Promise<void> {
  const frontmatter = await frontmatterOf(name);
  await deleteLibrary(name, stringsOf(frontmatter.files));
  await reloadConfig();
}

export async function installPlug(uri: string, path: string): Promise<void> {
  if (!path.endsWith(".plug.js")) {
    throw new Error("Plug path must end with .plug.js");
  }
  await space.writeFile(path, await readUriAsBytes(uri));
  await hotLoadPlugs([path]);
  await reloadConfig();
}

export async function removePlug(path: string): Promise<void> {
  await unloadPlug(path);
  await space.deleteFile(path);
  await reloadConfig();
}

export async function addRepository(uri: string, page: string): Promise<void> {
  await shareInstall(uri, { page: repositoryPage(page) });
  await reloadConfig();
}

export async function updateRepository(
  name: string,
): Promise<{ changed: boolean }> {
  const changed = !!(await lua.evalExpression(
    `share.sharePage(${luaString(name)})`,
  ));
  if (changed) await reloadConfig();
  return { changed };
}

/** Updates what is installed under `name`, whether a library or a repository. */
export async function updateByName(
  name: string,
): Promise<{ changed: boolean }> {
  const { installed, repositories } = await listLibraries();
  if (repositories.some((r) => r.name === name)) {
    return await updateRepository(name);
  }
  const lib = installed.find((l) => l.name === name);
  if (lib?.uri && isUpdatable(lib)) {
    return await updateLibrary({ name, uri: lib.uri });
  }
  throw new Error(`Not an installed library or repository: ${name}`);
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
    .filter(isUpdatableRepository)
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
  await reloadConfig();
  return { updated, errors };
}

export async function removeRepository(name: string): Promise<void> {
  await space.deletePage(name);
  await reloadConfig();
}

// Remote reads for Check for updates that run side by side
const CHECK_CONCURRENCY = 6;

/** Reads every installed library's and repository's remote once; never writes. */
export async function checkUpdates(): Promise<Record<string, LibraryCheck>> {
  const { installed, repositories } = await listLibraries();
  const queue = [
    ...installed.filter(isUpdatable).map((l) => l.name),
    ...repositories.filter(isUpdatableRepository).map((r) => r.name),
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
