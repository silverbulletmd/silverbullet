import { afterEach, beforeEach, expect, test } from "vitest";

// `routes.ts` computes SPACES_BASE at module load from `document.baseURI`, so
// the globals must exist BEFORE the module is imported. Static imports are
// hoisted above any beforeEach, hence the dynamic import in `load()` plus a
// module-registry reset so each test gets a freshly evaluated copy.
async function load(pathname: string, search = "") {
  (globalThis as any).document = { baseURI: "http://localhost:3000/.spaces/" };
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

test("SPACES_BASE strips the trailing slash from the document base", async () => {
  const { SPACES_BASE } = await load("/.spaces/");
  expect(SPACES_BASE).toBe("/.spaces");
});

test("spacesUrl joins with exactly one slash", async () => {
  const { spacesUrl } = await load("/.spaces/");
  expect(spacesUrl("/users")).toBe("/.spaces/users");
  expect(spacesUrl("users")).toBe("/.spaces/users");
});

test("the bare base is the spaces list", async () => {
  const { parseSpacesRoute } = await load("/.spaces");
  expect(parseSpacesRoute()).toEqual({ screen: "spaces" });
});

test("index.html is the spaces list, not a space id", async () => {
  const { parseSpacesRoute } = await load("/.spaces/index.html");
  expect(parseSpacesRoute()).toEqual({ screen: "spaces" });
});

test("static segments beat the space-id catch-all", async () => {
  // This is the precedence property that mirrors the server's matchit routing.
  // If it regresses, `/new` and `/users` silently become space ids.
  expect((await load("/.spaces/new")).parseSpacesRoute()).toEqual({
    screen: "space-new",
  });
  expect((await load("/.spaces/users")).parseSpacesRoute()).toEqual({
    screen: "users",
  });
  expect((await load("/.spaces/users/new")).parseSpacesRoute()).toEqual({
    screen: "user-new",
  });
});

test("a bare single segment is a space id", async () => {
  expect((await load("/.spaces/abc-123")).parseSpacesRoute()).toEqual({
    screen: "space",
    id: "abc-123",
  });
});

test("percent-encoded ids and usernames are decoded", async () => {
  expect((await load("/.spaces/users/a%20b")).parseSpacesRoute()).toEqual({
    screen: "user",
    username: "a b",
  });
});

test("an unknown deep path is not-found", async () => {
  expect((await load("/.spaces/a/b/c")).parseSpacesRoute()).toEqual({
    screen: "not-found",
  });
});

// --- safeSpacesDestination: the open-redirect guard -----------------------

test("safeSpacesDestination accepts an in-base path", async () => {
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination("/.spaces/users")).toBe("/.spaces/users");
  // The query string and hash must round-trip too — a naive rewrite of the
  // return statement (e.g. dropping `url.search`/`url.hash`) would still
  // pass the assertion above since it has neither.
  expect(safeSpacesDestination("/.spaces/users?tab=2#section")).toBe(
    "/.spaces/users?tab=2#section",
  );
});

test("safeSpacesDestination rejects a cross-origin destination", async () => {
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination("https://evil.example/.spaces/users")).toBe(
    undefined,
  );
});

test("safeSpacesDestination rejects a protocol-relative destination", async () => {
  // "//evil.example/.spaces/x" parses as an absolute URL with a different
  // origin — the classic open-redirect payload that looks like a local
  // path. The pathname deliberately matches SPACES_BASE so this can only be
  // caught by the origin check, not by the (separate) base-prefix check —
  // "//evil.example/x" would have been rejected by the base-prefix check
  // alone and wouldn't have exercised the origin check at all.
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination("//evil.example/.spaces/x")).toBe(undefined);
});

test("safeSpacesDestination rejects a same-origin path outside the base", async () => {
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination("/some-space/secret")).toBe(undefined);
});

test("safeSpacesDestination rejects a prefix-collision path", async () => {
  // "/.spacesevil" starts with "/.spaces" but is NOT inside it; the guard
  // compares against `${SPACES_BASE}/` for exactly this reason.
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination("/.spacesevil/x")).toBe(undefined);
});

test("safeSpacesDestination rejects the login page itself", async () => {
  // Otherwise ?next=/.spaces/login bounces the user in a loop.
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination("/.spaces/login")).toBe(undefined);
});

test("safeSpacesDestination rejects empty and null", async () => {
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination(null)).toBe(undefined);
  expect(safeSpacesDestination("")).toBe(undefined);
});

// Sweep of open-redirect payload shapes that a naive origin/path check could
// let slip through. The reviewer confirmed all of these are correctly
// rejected today — these tests exist so that a future simplification of the
// guard in safeSpacesDestination can't silently reintroduce one.
test.each([
  "/\\evil.example",
  "\\\\evil.example",
  "https:/evil.example/x",
  "https://evil@localhost:3000/.spaces/users",
  "HTTPS://evil.example/x",
  "javascript:alert(1)",
  "  //evil.example/x",
  "/.spaces/../secret",
])("safeSpacesDestination rejects open-redirect payload: %s", async (payload) => {
  const { safeSpacesDestination } = await load("/.spaces/login");
  expect(safeSpacesDestination(payload)).toBe(undefined);
});

// --- loginUrl ---------------------------------------------------------------

test("loginUrl encodes a safe next destination as the query param", async () => {
  const { loginUrl } = await load("/.spaces/users", "");
  expect(loginUrl("/.spaces/users/alice")).toBe(
    "/.spaces/login?next=%2F.spaces%2Fusers%2Falice",
  );
});

test("loginUrl omits the next param when the destination is rejected", async () => {
  // safeSpacesDestination rejects this (cross-origin), so it must not leak
  // into the query string — an unguarded loginUrl would let a caller smuggle
  // an open-redirect payload straight through as `next`.
  const { loginUrl } = await load("/.spaces/users", "");
  expect(loginUrl("https://evil.example/.spaces/users")).toBe("/.spaces/login");
});

test("loginUrl defaults next to the current location", async () => {
  const { loginUrl } = await load("/.spaces/users", "?tab=2");
  expect(loginUrl()).toBe("/.spaces/login?next=%2F.spaces%2Fusers%3Ftab%3D2");
});

test("loginUrl's default argument is still passed through the safety check", async () => {
  // The default isn't a special case that bypasses safeSpacesDestination —
  // if the current location itself isn't a safe destination (here, outside
  // SPACES_BASE), calling loginUrl() with no argument must omit `next` too.
  const { loginUrl } = await load("/somewhere-else", "");
  expect(loginUrl()).toBe("/.spaces/login");
});
