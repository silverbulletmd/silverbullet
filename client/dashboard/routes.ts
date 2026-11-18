import { SPACE_SECTIONS, type SpaceSection } from "./space_settings.ts";
export const DASHBOARD_BASE = new URL(document.baseURI).pathname.replace(
  /\/+$/,
  "",
);

export const SETTINGS_SECTIONS = {
  server: "Server",
  authentication: "Authentication",
  search: "Search",
  apis: "APIs",
} as const;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

export const STATUS_SECTIONS = {
  runtimes: "Runtimes",
  apps: "Connected apps",
  search: "Search",
  sync: "Sync",
} as const;
export type StatusSection = keyof typeof STATUS_SECTIONS;

export type DashboardRoute =
  | { screen: "login"; next?: string }
  | { screen: "spaces" }
  | { screen: "space-new" }
  | { screen: "space"; id: string; section?: SpaceSection }
  | { screen: "space-git"; id: string }
  | { screen: "users" }
  | { screen: "user-new" }
  | { screen: "user"; username: string }
  | { screen: "profile" }
  | { screen: "settings"; section: SettingsSection }
  | { screen: "status"; section: StatusSection }
  | { screen: "not-found" };

export function dashboardUrl(path: string): string {
  return `${DASHBOARD_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function decoded(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** The `?section=` of the current address, if it names one of `sections`. */
function pickSection<S extends string>(
  sections: Record<S, string>,
): S | undefined {
  const section = new URLSearchParams(location.search).get("section");
  return section !== null && Object.hasOwn(sections, section)
    ? (section as S)
    : undefined;
}

export function parseDashboardRoute(): DashboardRoute {
  const pathname = location.pathname.replace(/\/+$/, "");
  const relative = pathname.startsWith(DASHBOARD_BASE)
    ? pathname.slice(DASHBOARD_BASE.length)
    : pathname;
  const segments = relative.split("/").filter(Boolean);
  if (segments.length === 0) return { screen: "spaces" };
  // The server serves `/index.html` as a deep link to the base route; without
  // this it would fall through to the space-id catch-all below.
  if (segments.length === 1 && segments[0] === "index.html") {
    return { screen: "spaces" };
  }
  if (segments[0] === "login" && segments.length === 1) {
    const next = safeDashboardDestination(
      new URLSearchParams(location.search).get("next"),
    );
    return { screen: "login", next };
  }
  if (segments[0] === "new" && segments.length === 1) {
    return { screen: "space-new" };
  }
  if (segments[0] === "settings" && segments.length === 1) {
    return {
      screen: "settings",
      section: pickSection(SETTINGS_SECTIONS) ?? "server",
    };
  }
  if (segments[0] === "status" && segments.length === 1) {
    return {
      screen: "status",
      section: pickSection(STATUS_SECTIONS) ?? "runtimes",
    };
  }
  if (segments[0] === "profile" && segments.length === 1) {
    return { screen: "profile" };
  }
  if (segments[0] === "users") {
    if (segments.length === 1) return { screen: "users" };
    if (segments.length === 2 && segments[1] === "new") {
      return { screen: "user-new" };
    }
    const username = decoded(segments[1]);
    if (segments.length === 2 && username) return { screen: "user", username };
  }
  if (segments.length === 2 && segments[1] === "git") {
    const id = decoded(segments[0]);
    if (id) return { screen: "space-git", id };
  }
  // A bare single segment is a space id. Checked last so "new", "users" and
  // "login" above win, mirroring matchit's static-over-param precedence.
  if (segments.length === 1) {
    const id = decoded(segments[0]);
    if (id) {
      const section = pickSection(SPACE_SECTIONS);
      return section
        ? { screen: "space", id, section }
        : { screen: "space", id };
    }
  }
  return { screen: "not-found" };
}

export function safeDashboardDestination(
  value: string | null,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return undefined;
    // Signing in on the way to connecting an MCP app returns to its consent page.
    if (url.pathname === "/.auth/mcp/authorize") {
      return `${url.pathname}${url.search}`;
    }
    if (!url.pathname.startsWith(`${DASHBOARD_BASE}/`)) return undefined;
    if (url.pathname === dashboardUrl("/login")) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

export function loginUrl(
  next = `${location.pathname}${location.search}`,
): string {
  const destination = safeDashboardDestination(next);
  const query = destination ? `?next=${encodeURIComponent(destination)}` : "";
  return `${dashboardUrl("/login")}${query}`;
}
