import { afterEach, beforeEach, expect, test } from "vitest";

// `routes.ts` computes DASHBOARD_BASE at module load from `document.baseURI`, so
// the globals must exist BEFORE the module is imported. Static imports are
// hoisted above any beforeEach, hence the dynamic import in `load()` plus a
// module-registry reset so each test gets a freshly evaluated copy.
async function load(pathname: string, search = "") {
  (globalThis as any).document = {
    baseURI: "http://localhost:3000/.dashboard/",
  };
  (globalThis as any).location = {
    origin: "http://localhost:3000",
    pathname,
    search,
  };
  const vitest = await import("vitest");
  vitest.vi.resetModules();
  return await import("./routes.ts");
}

beforeEach(() => {
  (globalThis as any).document = undefined;
  (globalThis as any).location = undefined;
});

afterEach(() => {
  delete (globalThis as any).document;
  delete (globalThis as any).location;
});

test("the bare base is the spaces list", async () => {
  const { parseDashboardRoute } = await load("/.dashboard");
  expect(parseDashboardRoute()).toEqual({ screen: "spaces" });
});

test("index.html is the spaces list, not a space id", async () => {
  const { parseDashboardRoute } = await load("/.dashboard/index.html");
  expect(parseDashboardRoute()).toEqual({ screen: "spaces" });
});

test("static segments beat the space-id catch-all", async () => {
  // This is the precedence property that mirrors the server's matchit routing.
  // If it regresses, `/new` and `/users` silently become space ids.
  expect((await load("/.dashboard/new")).parseDashboardRoute()).toEqual({
    screen: "space-new",
  });
  expect((await load("/.dashboard/users")).parseDashboardRoute()).toEqual({
    screen: "users",
  });
  expect((await load("/.dashboard/users/new")).parseDashboardRoute()).toEqual({
    screen: "user-new",
  });
});

test("a bare single segment is a space id", async () => {
  expect((await load("/.dashboard/abc-123")).parseDashboardRoute()).toEqual({
    screen: "space",
    id: "abc-123",
  });
});

test("percent-encoded ids and usernames are decoded", async () => {
  expect((await load("/.dashboard/users/a%20b")).parseDashboardRoute()).toEqual(
    {
      screen: "user",
      username: "a b",
    },
  );
});

test("an unknown deep path is not-found", async () => {
  expect((await load("/.dashboard/a/b/c")).parseDashboardRoute()).toEqual({
    screen: "not-found",
  });
});

test("safeDashboardDestination accepts an in-base path", async () => {
  const { safeDashboardDestination } = await load("/.dashboard/login");
  expect(safeDashboardDestination("/.dashboard/users")).toBe(
    "/.dashboard/users",
  );
  // The query string and hash must round-trip too — a naive rewrite of the
  // return statement (e.g. dropping `url.search`/`url.hash`) would still
  // pass the assertion above since it has neither.
  expect(safeDashboardDestination("/.dashboard/users?tab=2#section")).toBe(
    "/.dashboard/users?tab=2#section",
  );
});

test("safeDashboardDestination rejects a prefix-collision path", async () => {
  // "/.dashboardevil" starts with "/.dashboard" but is NOT inside it; the guard
  // compares against `${DASHBOARD_BASE}/` for exactly this reason.
  const { safeDashboardDestination } = await load("/.dashboard/login");
  expect(safeDashboardDestination("/.dashboardevil/x")).toBe(undefined);
});

test("safeDashboardDestination rejects the login page itself", async () => {
  // Otherwise ?next=/.dashboard/login bounces the user in a loop.
  const { safeDashboardDestination } = await load("/.dashboard/login");
  expect(safeDashboardDestination("/.dashboard/login")).toBe(undefined);
});

test("safeDashboardDestination keeps the MCP consent page", async () => {
  // Signing in on the way to connecting an app must land back on the consent
  // page with every parameter intact.
  const { safeDashboardDestination } = await load("/.dashboard/login");
  expect(safeDashboardDestination("/.auth/mcp/authorize?client_id=x")).toBe(
    "/.auth/mcp/authorize?client_id=x",
  );
  expect(
    safeDashboardDestination(
      "http://localhost:3000/.auth/mcp/authorize?client_id=x&state=a%26b",
    ),
  ).toBe("/.auth/mcp/authorize?client_id=x&state=a%26b");
});

// Sweep of open-redirect payload shapes that a naive origin/path check could
// let slip through. The reviewer confirmed all of these are correctly
// rejected today — these tests exist so that a future simplification of the
// guard in safeDashboardDestination can't silently reintroduce one.
test.each([
  // Cross-origin, protocol-relative ("//evil.example/.dashboard/x" keeps a
  // pathname matching DASHBOARD_BASE, so only the origin check catches it),
  // outside the base, other auth pages, foreign MCP consent, empty and null.
  "https://evil.example/.dashboard/users",
  "//evil.example/.dashboard/x",
  "/some-space/secret",
  "/.auth/authorize?x",
  "/.auth/mcp/authorize/extra",
  "https://evil.example/.auth/mcp/authorize",
  "//evil.example/.auth/mcp/authorize?client_id=x",
  "",
  null,
  "/\\evil.example",
  "\\\\evil.example",
  "https:/evil.example/x",
  "https://evil@localhost:3000/.dashboard/users",
  "HTTPS://evil.example/x",
  "javascript:alert(1)",
  "  //evil.example/x",
  "/.dashboard/../secret",
])(
  "safeDashboardDestination rejects open-redirect payload: %s",
  async (payload: string | null) => {
    const { safeDashboardDestination } = await load("/.dashboard/login");
    expect(safeDashboardDestination(payload)).toBe(undefined);
  },
);

test("loginUrl encodes a safe next destination as the query param", async () => {
  const { loginUrl } = await load("/.dashboard/users", "");
  expect(loginUrl("/.dashboard/users/alice")).toBe(
    "/.dashboard/login?next=%2F.dashboard%2Fusers%2Falice",
  );
});

test("loginUrl omits the next param when the destination is rejected", async () => {
  // safeDashboardDestination rejects this (cross-origin), so it must not leak
  // into the query string — an unguarded loginUrl would let a caller smuggle
  // an open-redirect payload straight through as `next`.
  const { loginUrl } = await load("/.dashboard/users", "");
  expect(loginUrl("https://evil.example/.dashboard/users")).toBe(
    "/.dashboard/login",
  );
});

test("loginUrl defaults next to the current location", async () => {
  const { loginUrl } = await load("/.dashboard/users", "?tab=2");
  expect(loginUrl()).toBe(
    "/.dashboard/login?next=%2F.dashboard%2Fusers%3Ftab%3D2",
  );
});

test("loginUrl's default argument is still passed through the safety check", async () => {
  // The default isn't a special case that bypasses safeDashboardDestination —
  // if the current location itself isn't a safe destination (here, outside
  // DASHBOARD_BASE), calling loginUrl() with no argument must omit `next` too.
  const { loginUrl } = await load("/somewhere-else", "");
  expect(loginUrl()).toBe("/.dashboard/login");
});

test("Git connection has a dedicated space route", async () => {
  expect(
    (await load("/.dashboard/notes%20team/git")).parseDashboardRoute(),
  ).toEqual({
    screen: "space-git",
    id: "notes team",
  });
});

test("space sections have refreshable query routes", async () => {
  expect(
    (
      await load("/.dashboard/notebook", "?section=revisions")
    ).parseDashboardRoute(),
  ).toEqual({
    screen: "space",
    id: "notebook",
    section: "revisions",
  });
});

test("existing authentication links open the Admin authentication section", async () => {
  expect(
    (await load("/.dashboard/authentication")).parseDashboardRoute(),
  ).toEqual({
    screen: "admin",
    section: "authentication",
  });
});

test("Admin defaults to Server and supports section links", async () => {
  for (const [query, section] of [
    ["", "server"],
    ["?section=invalid", "server"],
    ["?section=authentication", "authentication"],
    ["?section=apis", "apis"],
    ["?section=runtimes", "apis"],
  ]) {
    expect(
      (await load("/.dashboard/admin", query)).parseDashboardRoute(),
    ).toEqual({
      screen: "admin",
      section,
    });
  }
});
