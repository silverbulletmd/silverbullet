export function resolvePath(
  currentPage: string,
  pathToResolve: string,
  fullUrl = false,
): string {
  if (isFederationPath(currentPage) && !isFederationPath(pathToResolve)) {
    let domainPart = currentPage.split("/")[0];
    if (fullUrl) {
      domainPart = domainPart.substring(1);
      if (domainPart.startsWith("localhost")) {
        domainPart = "http://" + domainPart;
      } else {
        domainPart = "https://" + domainPart;
      }
    }
    return `${domainPart}/${pathToResolve}`;
  } else {
    return pathToResolve;
  }
}

export function isFederationPath(path: string) {
  return path.startsWith("!");
}
