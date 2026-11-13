/** What `/.auth/central/public` tells anyone, signed in or not. */
type PublicConfig = { serverName?: unknown };

let request: Promise<PublicConfig | undefined> | undefined;

/** The server's public settings, fetched once per page for every consumer. */
export function publicConfig(): Promise<PublicConfig | undefined> {
  request ??= fetch("/.auth/central/public")
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);
  return request;
}
