import { type ParseTree, traverseTree } from "./tree.ts";

const builtinPrefixes = [
  "tag:",
  "search:",
];

// [[Wikilinks]] use absolute paths and should pass pathToResolve with a leading / to this function
// [Markdown links]() are relative unless it has a leading /
export function resolvePath(
  currentPage: string,
  pathToResolve: string,
): string {
  // [Markdown links]() with spaces in the url need to be uri encoded or wrapped in <>
  if (pathToResolve.startsWith("<") && pathToResolve.endsWith(">")) {
    pathToResolve = pathToResolve.slice(1, -1);
  }
  if (
    strippableSlashPrefix(pathToResolve)
  ) {
    pathToResolve = pathToResolve.slice(1);
  } else {
    pathToResolve = relativeToAbsolutePath(currentPage, pathToResolve);
  }
  return pathToResolve;
}

function strippableSlashPrefix(p: string) {
  return p.startsWith("/");
}

export function isLocalPath(path: string): boolean {
  return !path.includes("://") &&
    !path.startsWith("mailto:") &&
    !path.startsWith("tel:");
}

export function rewritePageRefs(tree: ParseTree, containerPageName: string) {
  traverseTree(tree, (n): boolean => {
    if (n.type === "WikiLinkPage") {
      n.children![0].text = resolvePath(
        containerPageName,
        "/" + n.children![0].text!,
      );
      return true;
    }

    return false;
  });
}

export function cleanPageRef(pageRef: string): string {
  if (pageRef.startsWith("[[") && pageRef.endsWith("]]")) {
    return pageRef.slice(2, -2);
  } else {
    return pageRef;
  }
}

export function folderName(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

export function absoluteToRelativePath(page: string, linkTo: string): string {
  // Remove leading /
  page = page.startsWith("/") ? page.slice(1) : page;
  linkTo = linkTo.startsWith("/") ? linkTo.slice(1) : linkTo;

  const splitLink = linkTo.split("/");
  const splitPage = page.split("/");
  splitPage.pop();

  while (splitPage && splitPage[0] === splitLink[0]) {
    splitPage.shift();
    splitLink.shift();
  }

  splitPage.fill("..");

  return [...splitPage, ...splitLink].join("/");
}

export function relativeToAbsolutePath(page: string, linkTo: string): string {
  // Remove leading /
  page = strippableSlashPrefix(page) ? page.slice(1) : page;
  linkTo = strippableSlashPrefix(linkTo) ? linkTo.slice(1) : linkTo;

  const splitPage = page.split("/").slice(0, -1);
  const splitLink = linkTo.split("/");

  while (splitLink && splitLink[0] === "..") {
    splitPage.pop();
    splitLink.shift();
  }

  return [...splitPage, ...splitLink].join("/");
}

export function isBuiltinPath(path: string): boolean {
  return builtinPrefixes.some((prefix) => path.startsWith(prefix));
}
