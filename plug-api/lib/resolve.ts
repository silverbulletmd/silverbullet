import { findNodeOfType, type ParseTree, traverseTree } from "./tree.ts";

// [[Wikilinks]] use absolute paths and should pass pathToResolve with a leading / to this function
// [Markdown links]() are relative unless it has a leading /
export function resolvePath(
  currentPage: string,
  pathToResolve: string,
  fullUrl = false,
): string {
  // [Markdown links]() with spaces in the url need to be uri encoded or wrapped in <>
  if (pathToResolve.startsWith("<") && pathToResolve.endsWith(">")) {
    pathToResolve = pathToResolve.slice(1, -1);
  }
  if (isFederationPath(pathToResolve)) {
    return pathToResolve;
  } else if (pathToResolve.startsWith("/")) {
    if (isFederationPath(currentPage)) {
      const domainPart = currentPage.split("/")[0];
      pathToResolve = domainPart + pathToResolve;
    } else {
      pathToResolve = pathToResolve.slice(1);
    }
  } else {
    pathToResolve = relativeToAbsolutePath(currentPage, pathToResolve);

    if (isFederationPath(currentPage) && !isFederationPath(pathToResolve)) {
      const domainPart = currentPage.split("/")[0];
      pathToResolve = domainPart + "/" + pathToResolve;
    }
  }
  if (fullUrl) {
    pathToResolve = federatedPathToUrl(pathToResolve);
  }
  return pathToResolve;
}

export function federatedPathToUrl(path: string): string {
  if (!isFederationPath(path)) {
    return path;
  }
  path = path.substring(1);
  if (path.startsWith("localhost")) {
    path = "http://" + path;
  } else {
    path = "https://" + path;
  }
  return path;
}

export function isFederationPath(path: string): boolean {
  return path.startsWith("!");
}

export function isLocalPath(path: string): boolean {
  return !path.includes("://") && !path.startsWith("mailto:");
}

export function rewritePageRefs(tree: ParseTree, containerPageName: string) {
  traverseTree(tree, (n): boolean => {
    if (n.type === "FencedCode") {
      const codeInfo = findNodeOfType(n, "CodeInfo");
      if (!codeInfo) {
        return true;
      }
      if (!["query", "template"].includes(codeInfo.children![0].text!)) {
        return true;
      }
      const codeText = findNodeOfType(n, "CodeText");
      if (!codeText) {
        return true;
      }
      let bodyText = codeText.children![0].text!;
      bodyText = rewritePageRefsInString(bodyText, containerPageName);
      codeText.children![0].text = bodyText;

      return true;
    }
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

export function rewritePageRefsInString(
  bodyText: string,
  containerPageName: string,
): string {
  return bodyText.replaceAll(/\[\[(.+)\]\]/g, (_match, pageRefName) => {
    return `[[${resolvePath(containerPageName, "/" + pageRefName)}]]`;
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
  page = page.startsWith("/") ? page.slice(1) : page;
  linkTo = linkTo.startsWith("/") ? linkTo.slice(1) : linkTo;

  const splitPage = page.split("/").slice(0, -1);

  const splitLink = linkTo.split("/");

  while (splitLink && splitLink[0] === "..") {
    splitPage.pop();
    splitLink.shift();
  }

  return [...splitPage, ...splitLink].join("/");
}
