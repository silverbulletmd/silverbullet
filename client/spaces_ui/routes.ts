export const SPACES_BASE = new URL(document.baseURI).pathname.replace(
  /\/+$/,
  "",
);

export type SpacesRoute =
  | { screen: "login"; next?: string }
  | { screen: "spaces" }
  | { screen: "space-new" }
  | { screen: "space"; id: string }
  | { screen: "users" }
  | { screen: "user-new" }
  | { screen: "user"; username: string }
  | { screen: "not-found" };

export function spacesUrl(path: string): string {
  return `${SPACES_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function decoded(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function parseSpacesRoute(): SpacesRoute {
  const pathname = location.pathname.replace(/\/+$/, "");
  const relative = pathname.startsWith(SPACES_BASE)
    ? pathname.slice(SPACES_BASE.length)
    : pathname;
  const segments = relative.split("/").filter(Boolean);
  if (segments.length === 0) return { screen: "spaces" };
  // The server serves `/index.html` as a deep link to the base route; without
  // this it would fall through to the space-id catch-all below.
  if (segments.length === 1 && segments[0] === "index.html") {
    return { screen: "spaces" };
  }
  if (segments[0] === "login" && segments.length === 1) {
    const next = safeSpacesDestination(
      new URLSearchParams(location.search).get("next"),
    );
    return { screen: "login", next };
  }
  if (segments[0] === "new" && segments.length === 1) {
    return { screen: "space-new" };
  }
  if (segments[0] === "users") {
    if (segments.length === 1) return { screen: "users" };
    if (segments.length === 2 && segments[1] === "new") {
      return { screen: "user-new" };
    }
    const username = decoded(segments[1]);
    if (segments.length === 2 && username) return { screen: "user", username };
  }
  // A bare single segment is a space id. Checked last so "new", "users" and
  // "login" above win, mirroring matchit's static-over-param precedence.
  if (segments.length === 1) {
    const id = decoded(segments[0]);
    if (id) return { screen: "space", id };
  }
  return { screen: "not-found" };
}

export function safeSpacesDestination(
  value: string | null,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return undefined;
    if (!url.pathname.startsWith(`${SPACES_BASE}/`)) return undefined;
    if (url.pathname === spacesUrl("/login")) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

export function loginUrl(
  next = `${location.pathname}${location.search}`,
): string {
  const destination = safeSpacesDestination(next);
  const query = destination ? `?next=${encodeURIComponent(destination)}` : "";
  return `${spacesUrl("/login")}${query}`;
}
