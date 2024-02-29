import { findNodeOfType, ParseTree, traverseTree } from "./tree.ts";

export function resolvePath(
  currentPage: string,
  pathToResolve: string,
  fullUrl = false,
): string {
  if (isFederationPath(currentPage) && !isFederationPath(pathToResolve)) {
    let domainPart = currentPage.split("/")[0];
    if (fullUrl) {
      domainPart = federatedPathToUrl(domainPart);
    }
    return `${domainPart}/${pathToResolve}`;
  } else {
    return pathToResolve;
  }
}

export function resolveAttachmentPath(
  currentPage: string,
  pathToResolve: string,
): string {
  const folder = folderName(currentPage);
  if (folder && !pathToResolve.startsWith("/")) {
    pathToResolve = folder + "/" + pathToResolve;
  }
  if (pathToResolve.startsWith("/")) {
    pathToResolve = pathToResolve.slice(1);
  }
  return federatedPathToUrl(resolvePath(currentPage, pathToResolve));
}

export function federatedPathToUrl(path: string): string {
  if (!path.startsWith("!")) {
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

export function isFederationPath(path: string) {
  return path.startsWith("!");
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
        n.children![0].text!,
      );
      return true;
    }

    return false;
  });
}

export function rewritePageRefsInString(
  bodyText: string,
  containerPageName: string,
) {
  return bodyText.replaceAll(/\[\[(.+)\]\]/g, (_match, pageRefName) => {
    return `[[${resolvePath(containerPageName, pageRefName)}]]`;
  });
}

export function cleanPageRef(pageRef: string) {
  if (pageRef.startsWith("[[") && pageRef.endsWith("]]")) {
    return pageRef.slice(2, -2);
  } else {
    return pageRef;
  }
}

export function folderName(path: string) {
  return path.split("/").slice(0, -1).join("/");
}
