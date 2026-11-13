// Library dependencies: the `requires:` list of a library page, each entry a
// share URI or a path relative to the requiring library's own URI

type Requirer = { name: string; uri?: string; requires?: string[] };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The part of a URI a relative entry can't climb out of (a repository at a
 * ref, a web origin) and the path after it.
 */
function splitRoot(uri: string): [string, string] | undefined {
  const m =
    uri.match(/^((?:github|ghr):[^/]+\/[^/]+\/)(.*)$/) ??
    uri.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/)(.*)$/) ??
    uri.match(/^(https?:\/\/[^/]+\/)(.*)$/) ??
    uri.match(/^([a-z][a-z0-9+.-]*:)(.*)$/i);
  return m ? [m[1], m[2]] : undefined;
}

/** `entry` as a full URI: as written, or resolved against `base`; undefined when it can't be. */
export function resolveLibraryUri(
  base: string | undefined,
  entry: string,
): string | undefined {
  if (SCHEME.test(entry)) return entry;
  // Ambiguous between the repository's root and the folder: neither is assumed
  if (entry.startsWith("/")) return undefined;
  const split = base ? splitRoot(base) : undefined;
  if (!split) return undefined;
  const [root, path] = split;
  const segments = path.split("/").slice(0, -1);
  for (const seg of entry.split("/")) {
    if (seg === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else if (seg !== "." && seg !== "") {
      segments.push(seg);
    }
  }
  return segments.length ? root + segments.join("/") : undefined;
}

/**
 * A library's `requires` as full URIs, and why entries that can't be used
 * can't, each to follow "<library> requires". Blank entries and non-strings
 * are skipped; anything but a list is no requirements.
 */
export function parseRequires(
  value: unknown,
  base: string | undefined,
): { uris: string[]; errors: string[] } {
  const uris: string[] = [];
  const errors: string[] = [];
  if (!Array.isArray(value)) return { uris, errors };
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const uri = resolveLibraryUri(base, entry.trim());
    if (uri) uris.push(uri);
    else if (entry.trim().startsWith("/")) {
      errors.push(
        `"${entry}": start a relative path with ./ or ../, or give a full URI`,
      );
    } else {
      errors.push(
        `"${entry}", which doesn't resolve against ${base ?? "a library without a URI"}`,
      );
    }
  }
  return { uris, errors };
}

/** The github: form of a GitHub file URI (with its default ref spelled out). */
function canonical(uri: string): string {
  const web = uri.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/([^/]+)\/(.*)$/,
  );
  if (web) return `github:${web[1]}@${web[2]}/${web[3]}`;
  const gh = uri.match(/^github:([^/@]+\/[^/@]+)\/(.*)$/);
  if (gh) return `github:${gh[1]}@main/${gh[2]}`;
  return uri;
}

/** Whether two URIs name the same library, whichever way GitHub's are spelled. */
export function sameLibraryUri(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

const requiresUri = (l: Requirer, uri: string) =>
  (l.requires ?? []).some((r) => sameLibraryUri(r, uri));

/** The installed libraries, other than `name` itself, that require it. */
export function requiredBy(installed: Requirer[], name: string): string[] {
  const uri = installed.find((l) => l.name === name)?.uri;
  if (!uri) return [];
  return installed
    .filter((l) => l.name !== name && requiresUri(l, uri))
    .map((l) => l.name);
}

/**
 * The installed libraries that keep `name` from being removed: those that
 * require it, except the ones it requires in turn, as in a circle each would
 * block the others for good.
 */
export function requirersOf(installed: Requirer[], name: string): string[] {
  const uri = installed.find((l) => l.name === name)?.uri;
  if (!uri) return [];
  const below = new Set<string>([name]);
  for (const queue = [name]; queue.length > 0; ) {
    const next = queue.shift();
    const lib = installed.find((l) => l.name === next);
    for (const dep of installed) {
      if (lib && dep.uri && !below.has(dep.name) && requiresUri(lib, dep.uri)) {
        below.add(dep.name);
        queue.push(dep.name);
      }
    }
  }
  return installed
    .filter((l) => !below.has(l.name) && requiresUri(l, uri))
    .map((l) => l.name);
}

/** A page name's or URI's last segment, without `.md`. */
export function libraryLabel(nameOrUri: string): string {
  const last = nameOrUri.split("/").pop() || nameOrUri;
  return last.replace(/\.md$/, "");
}

const andList = (names: string[]) =>
  names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Why `name` can't be removed while `requirers` are installed. */
export function removeBlockedMessage(
  name: string,
  requirers: string[],
  label: (name: string) => string,
): string {
  const who = andList(requirers.map(label));
  const verb = requirers.length === 1 ? "requires" : "require";
  return `${who} ${verb} ${label(name)}. Remove ${who} first.`;
}
