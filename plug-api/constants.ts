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

/**
 * Determines if an error thrown by fetch() is a network-level error
 * (as opposed to a server-side or application error).
 *
 * Browser-specific error messages when there is no internet connection:
 * - Firefox: "NetworkError when attempting to fetch resource"
 * - Safari (service worker): "FetchEvent.respondWith received an error: TypeError: Load failed"
 * - Safari (no service worker): "Load failed"
 * - Chrome: "Failed to fetch"
 */
export function isNetworkError(e: any): boolean {
  const msg = (e?.message || "").toLowerCase();
  return (
    msg.includes("fetch") ||
    msg.includes("load failed") ||
    msg.includes("networkerror") ||
    msg.includes("unavailable")
  );
}
