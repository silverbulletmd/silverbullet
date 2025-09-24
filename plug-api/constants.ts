export const maximumDocumentSize = 10; // MiB
export const defaultLinkStyle = "wikilink";
export const offlineError = new Error("Offline");
export const notFoundError = new Error("Not found");
export const notAuthenticatedError = new Error("Unauthenticated");
export const wrongSpacePathError = new Error(
  "Space folder path different on server, reloading the page",
);
export const pingTimeout = 2000;
export const pingInterval = 5000;
