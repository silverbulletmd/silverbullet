export const maximumDocumentSize: number = 10; // MiB
export const defaultLinkStyle: string = "wikilink";
export const offlineError: Error = new Error("Offline");
export const notFoundError: Error = new Error("Not found");
export const notAuthenticatedError: Error = new Error("Unauthenticated");
export const wrongSpacePathError: Error = new Error(
  "Space folder path different on server, reloading the page",
);
export const pingTimeout: number = 2000;
export const pingInterval: number = 5000;
