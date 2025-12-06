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
 * HTTP status codes that should be treated as "offline" conditions.
 *
 * This is particularly useful for cases where a proxy (such as Cloudflare or other reverse proxies)
 * indicates that the backend server is down, but there is still network connectivity between
 * the user and the proxy. In these scenarios, we want to allow the user to continue working
 * with their cached data rather than showing an error, even though technically there is network
 * connectivity to the proxy.
 *
 * This enables SilverBullet to work in a true "offline-first" manner, falling back to cached
 * content when the backend is unavailable through no fault of the user's network connection.
 */
export const offlineStatusCodes = {
  502: "Bad Gateway", // Proxy server received invalid response from upstream server
  503: "Service Unavailable", // Server is temporarily unable to handle the request
  504: "Gateway Timeout", // Proxy server did not receive a timely response from upstream server

  530: "Unable to resolve origin hostname", // Served when cloudflared is down on the host
} as const;
