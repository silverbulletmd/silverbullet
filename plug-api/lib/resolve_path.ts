import type { Path } from "./ref.ts";
import { fileName, folderName } from "./resolve.ts";

export type ResolveResult = {
  path: Path;
  exists: boolean;
  ambiguous: boolean;
  candidates?: Path[];
};

export type PathIndex = {
  has(path: string): boolean;
  candidates(basename: string): Path[];
};

export class BasenameIndex implements PathIndex {
  private paths = new Set<string>();
  private byBasename = new Map<string, Set<string>>();
  // Keys whose bucket holds more than one path, maintained incrementally so a
  // snapshot of every collision costs O(collisions), not a walk of the space.
  private collidingKeys = new Set<string>();

  rebuild(paths: Iterable<string>): void {
    this.clear();
    for (const path of paths) {
      this.add(path);
    }
  }

  clear(): void {
    this.paths.clear();
    this.byBasename.clear();
    this.collidingKeys.clear();
  }

  add(path: string): void {
    if (this.paths.has(path)) {
      return;
    }
    this.paths.add(path);
    const key = basenameKey(path);
    let bucket = this.byBasename.get(key);
    if (!bucket) {
      bucket = new Set();
      this.byBasename.set(key, bucket);
    }
    bucket.add(path);
    if (bucket.size > 1) {
      this.collidingKeys.add(key);
    }
  }

  delete(path: string): void {
    if (!this.paths.delete(path)) {
      return;
    }
    const key = basenameKey(path);
    const bucket = this.byBasename.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(path);
    if (bucket.size < 2) {
      this.collidingKeys.delete(key);
    }
    if (bucket.size === 0) {
      this.byBasename.delete(key);
    }
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  candidates(basename: string): Path[] {
    const bucket = this.byBasename.get(basename.toLowerCase());
    return bucket ? ([...bucket] as Path[]) : [];
  }

  /**
   * Every basename carried by more than one file, with the files that carry
   * it. Under the "a bare link exists iff its basename is unique" invariant
   * collisions are rare, so this is a small snapshot of a large space — which
   * is what makes it cheap to ship across the sandbox boundary.
   */
  collidingBuckets(): Record<string, Path[]> {
    const result: Record<string, Path[]> = {};
    for (const key of this.collidingKeys) {
      result[key] = [...this.byBasename.get(key)!] as Path[];
    }
    return result;
  }
}

export function basenameKey(path: string): string {
  return fileName(path).toLowerCase();
}

function folderSegments(path: Path): string[] {
  const folder = folderName(path);
  return folder === "" ? [] : folder.split("/");
}

function sharedDepth(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return i;
}

/**
 * Ranks same-basename candidates relative to the linking page: deepest shared
 * folder prefix first, then shallowest, then lexicographic. Obsidian ranks the
 * vault root above the linking page's own folder; inverting that is deliberate
 * (see the design spec) — root-wins would resolve a link inside `docs/api/` to
 * a sibling project's root-level file whenever a space is opened at a wider
 * root. Root preference survives as the shallowest-path rule, since the root is
 * always depth 0.
 */
export function rankCandidates(candidates: Path[], fromPage: Path): Path[] {
  const from = folderSegments(fromPage);
  return [...candidates].sort((a, b) => {
    const aFolder = folderSegments(a);
    const bFolder = folderSegments(b);
    const proximity = sharedDepth(bFolder, from) - sharedDepth(aFolder, from);
    if (proximity !== 0) {
      return proximity;
    }
    const depth = aFolder.length - bFolder.length;
    if (depth !== 0) {
      return depth;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * What a sandboxed caller gets back for one requested path: whether that exact
 * path exists, plus every file sharing its basename. Ranking deliberately stays
 * out of the syscall — it runs in the caller, from the same pure function the
 * client uses, so there is only ever one implementation of it.
 */
export type PathLookup = {
  exact: boolean;
  candidates: Path[];
};

/**
 * Adapts a batch of lookups into a {@link PathIndex}. Exact-path answers stay
 * keyed by the requested path, while candidates are re-keyed by basename —
 * which is how both `resolvePath` and `writeLinkPath` ask for them. Keying
 * candidates by the requested path instead silently returns none for anything
 * in a folder.
 */
export function lookupIndex(lookups: Record<string, PathLookup>): PathIndex {
  const byBasename = new Map<string, Path[]>();
  for (const [path, lookup] of Object.entries(lookups)) {
    byBasename.set(basenameKey(path), lookup.candidates);
  }
  return {
    has: (path) => lookups[path]?.exact ?? false,
    candidates: (basename) => byBasename.get(basename.toLowerCase()) ?? [],
  };
}

/**
 * A {@link PathIndex} for *write-format decisions only*, built from just the
 * colliding buckets of {@link BasenameIndex.collidingBuckets}. Enough for
 * {@link writeLinkPath} on paths of files that exist: a basename outside the
 * buckets is unique by construction, so `candidates` answers with a
 * single-entry stand-in, and `has` only ever needs to look inside a bucket
 * (every exact path a suffix could be shadowed by shares the suffix's own
 * basename). Not a resolution index — do not hand it to `resolvePath` callers.
 */
export function collisionIndex(colliding: Record<string, Path[]>): PathIndex {
  return {
    has: (path) =>
      colliding[basenameKey(path)]?.includes(path as Path) ?? false,
    candidates: (basename) =>
      colliding[basename.toLowerCase()] ?? ([basename] as Path[]),
  };
}

export type LinkWriteFormat = "shortest" | "shortest-suffix" | "full-path";

/**
 * Renders a target path as link text. `shortest` writes the bare name only when
 * that name is unique in the space — the rule that maintains the "a bare link
 * exists iff its basename is unique" invariant on the write side — and the
 * full path otherwise. `shortest-suffix` differs only in the colliding case:
 * instead of the full path it writes the shortest path suffix that resolves
 * back to exactly this file, which keeps even disambiguated links independent
 * of where the space root sits.
 */
export function writeLinkPath(
  target: Path,
  format: LinkWriteFormat,
  index: PathIndex,
): Path {
  if (format === "full-path") {
    return target;
  }
  const bare = fileName(target);
  if (index.candidates(bare).length === 1) {
    return bare;
  }
  if (format === "shortest") {
    return target;
  }
  // Every rival a suffix could collide with shares the target's basename, so
  // the basename bucket is a complete rival list and resolvePath can verify
  // each candidate outright: rejected when it is another file's exact path,
  // ambiguous, or resolving elsewhere. fromPage is irrelevant — only
  // unambiguous resolutions are accepted, and those are page-independent.
  const segments = target.split("/");
  for (let i = segments.length - 2; i >= 1; i--) {
    const candidate = segments.slice(i).join("/") as Path;
    const resolution = resolvePath(candidate, "" as Path, index);
    if (
      resolution.exists &&
      !resolution.ambiguous &&
      resolution.path === target
    ) {
      return candidate;
    }
  }
  return target;
}

/**
 * Resolves a parsed ref path against the space. Exact paths always win, so
 * every link that resolves today keeps resolving to the same file. A bare name
 * falls back to a space-wide basename lookup; more than one survivor means the
 * "bare link iff unique basename" invariant is violated, which resolves
 * deterministically but is reported as ambiguous so callers can flag it.
 *
 * A qualified path with no exact match falls back to a path-suffix lookup:
 * `api/Auth` finds `docs/api/Auth.md` when that is the only file whose path
 * ends that way. This is what lets a space opened at a wider root — the parent
 * of the `docs/` folder it was authored in — keep its qualified links working,
 * not just its bare ones, and it matches Obsidian accepting partial paths as
 * linkpaths.
 */
export function resolvePath(
  path: Path,
  fromPage: Path,
  index: PathIndex,
): ResolveResult {
  if (path === "") {
    return { path, exists: true, ambiguous: false };
  }
  const bare = !path.includes("/");

  if (index.has(path)) {
    // An exact path match is fully determined by the link text, so it is never
    // reported ambiguous — even when other files share the basename. For a
    // root-level file the bare and qualified forms are the same string, so
    // there is nothing the author could write instead and the warning could
    // never be cleared.
    return { path, exists: true, ambiguous: false };
  }

  // Both lookups start from the basename bucket; a qualified path just has to
  // match more of its tail.
  let candidates = index.candidates(fileName(path));
  if (!bare) {
    const suffix = `/${path.toLowerCase()}`;
    candidates = candidates.filter((candidate) =>
      candidate.toLowerCase().endsWith(suffix),
    );
  }
  if (candidates.length === 0) {
    return { path, exists: false, ambiguous: false };
  }

  const matchesCase = bare
    ? (candidate: Path) => fileName(candidate) === path
    : (candidate: Path) => candidate.endsWith(`/${path}`);
  const exactCase = candidates.filter(matchesCase);
  const ranked = rankCandidates(
    exactCase.length > 0 ? exactCase : candidates,
    fromPage,
  );
  if (ranked.length === 1) {
    return { path: ranked[0], exists: true, ambiguous: false };
  }
  return { path: ranked[0], exists: true, ambiguous: true, candidates: ranked };
}
