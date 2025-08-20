import type { Path } from "@silverbulletmd/silverbullet/lib/ref";

/**
 * Determines wether a url points into the world wide web or to the local SB instance
 */
export function isLocalURL(url: string): boolean {
  return !url.includes("://") &&
    !url.startsWith("mailto:") &&
    !url.startsWith("tel:");
}

/**
 * Extracts the folder name from a page or document name or a path
 */
export function folderName(name: string | Path): string {
  return name.split("/").slice(0, -1).join("/");
}

export function fileName(path: Path): Path;
export function fileName(name: string): string;
export function fileName(name: string | Path): string | Path {
  return name.split("/").pop()!;
}

const builtinPrefixes = [
  "tag:",
  "search:",
];

/**
 * Builtin pages are pages which SB should automatically consider as existing
 */
export function isBuiltinPath(path: Path): boolean {
  return builtinPrefixes.some((prefix) => path.startsWith(prefix));
}

/**
 * Resolves a markdown link url relative to an absolute url.
 */
export function resolveMarkdownLink(
  absolute: string,
  relative: string,
): string {
  // These are part of the commonmark spec for urls with spaces inbetween.
  if (relative.startsWith("<") && relative.endsWith(">")) {
    relative = relative.slice(1, -1);
  }

  if (relative.startsWith("/")) {
    return relative.slice(1);
  } else {
    const splitAbsolute = absolute
      .split("/")
      .slice(0, -1)
      .filter((p) => p);
    const splitRelative = relative
      .split("/")
      .filter((p) => p);

    while (splitRelative && splitRelative[0] === "..") {
      splitAbsolute.pop();
      splitRelative.shift();
    }

    return [...splitAbsolute, ...splitRelative].join("/") as Path;
  }
}

/**
 * Turns an absolute path into a relative path, relative to some base directory. USE WITH CAUTION, definitely buggy
 */
export function absoluteToRelativePath(base: string, absolute: string): string {
  // Remove leading /
  base = base.startsWith("/") ? base.slice(1) : base;
  absolute = absolute.startsWith("/") ? absolute.slice(1) : absolute;

  const splitAbsolute = absolute.split("/");
  const splitBase = base.split("/");
  splitBase.pop();

  // TODO: This is definitely not robust
  while (splitBase && splitBase[0] === splitAbsolute[0]) {
    splitBase.shift();
    splitAbsolute.shift();
  }

  splitBase.fill("..");

  return [...splitBase, ...splitAbsolute].join("/");
}
