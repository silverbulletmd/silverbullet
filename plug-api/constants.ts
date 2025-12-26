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
 *
 * All 5xx server errors are included to prevent the client from caching error HTML pages
 * (e.g., Nginx 500 error pages) which would prevent the client from booting in offline mode.
 */
export const offlineStatusCodes = {
  500: "Internal Server Error", // Server encountered an unexpected condition
  501: "Not Implemented", // Server does not support the functionality required
  502: "Bad Gateway", // Proxy server received invalid response from upstream server
  503: "Service Unavailable", // Server is temporarily unable to handle the request
  504: "Gateway Timeout", // Proxy server did not receive a timely response from upstream server
  505: "HTTP Version Not Supported", // Server does not support the HTTP version
  506: "Variant Also Negotiates", // Server has an internal configuration error
  507: "Insufficient Storage", // Server is unable to store the representation
  508: "Loop Detected", // Server detected an infinite loop while processing
  509: "Bandwidth Limit Exceeded", // Server bandwidth limit has been exceeded
  510: "Not Extended", // Further extensions to the request are required
  511: "Network Authentication Required", // Client needs to authenticate to gain network access

  530: "Unable to resolve origin hostname", // Served when cloudflared is down on the host
} as const;
