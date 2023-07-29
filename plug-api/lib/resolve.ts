export function resolvePath(
  currentPage: string,
  pathToResolve: string,
  fullUrl = false,
): string {
  if (currentPage.startsWith("!") && !pathToResolve.startsWith("!")) {
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
