import { afterEach, expect, test } from "vitest";
import { bindingLabel, spaceUrl } from "./bindings.ts";

afterEach(() => {
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).location;
});

test('spaceUrl normalizes a bare-root prefix of "" to "/"', () => {
  expect(spaceUrl({ prefix: "" })).toBe("/");
});

test('spaceUrl normalizes a literal "/" prefix to "/", not "//"', () => {
  // The server accepts a bare "/" prefix. Appending another slash would
  // produce an invalid protocol-relative URL.
  expect(spaceUrl({ prefix: "/" })).toBe("/");
});

test("spaceUrl appends a trailing slash to a normal prefix", () => {
  expect(spaceUrl({ prefix: "/foo" })).toBe("/foo/");
});

test("spaceUrl doesn't double up a prefix that already ends in a slash", () => {
  expect(spaceUrl({ prefix: "/foo/" })).toBe("/foo/");
});

test("spaceUrl for a bare host binding retains its prefix without the listener port", () => {
  expect(spaceUrl({ host: "team.test", prefix: "/work" })).toBe(
    "//team.test/work/",
  );
});

test("spaceUrl preserves a port explicitly included in the host binding", () => {
  expect(spaceUrl({ host: "team.test:4100", prefix: "/work" })).toBe(
    "//team.test:4100/work/",
  );
});

test('bindingLabel shows a bare-root prefix as "/"', () => {
  expect(bindingLabel({ prefix: "" })).toBe("/");
  expect(bindingLabel({ prefix: "/" })).toBe("/");
});

test("bindingLabel shows only a port explicitly included in the host binding", () => {
  expect(bindingLabel({ host: "team.test", prefix: "/work" })).toBe(
    "team.test/work",
  );
  expect(bindingLabel({ host: "team.test:4100", prefix: "/work" })).toBe(
    "team.test:4100/work",
  );
});

test("space entry carries central encryption to the destination hostname while preserving ordinary links", async () => {
  (globalThis as any).location = {
    port: "3000",
    href: "https://login.sb.test:3000/.dashboard/",
  };
  const { spaceEntryUrl } = await import("./bindings.ts");
  expect(spaceEntryUrl({ host: "notes.test" }, false)).toBe("//notes.test/");
  const encrypted = new URL(spaceEntryUrl({ host: "notes.test" }, true));
  expect(encrypted.origin).toBe("https://notes.test");
  expect(encrypted.pathname).toBe("/.auth/central/start");
  expect(encrypted.searchParams.get("destination")).toBe("https://notes.test/");
  expect(encrypted.searchParams.get("encrypt")).toBe("true");
  expect(
    new URL(spaceEntryUrl({ prefix: "/notes" }, true)).searchParams.get(
      "destination",
    ),
  ).toBe("https://login.sb.test:3000/notes/");
});

test("space entry carries a hostname prefix into the central-login destination", async () => {
  (globalThis as any).location = {
    port: "3000",
    href: "https://login.sb.test:3000/.dashboard/",
  };
  const { spaceEntryUrl } = await import("./bindings.ts");
  const encrypted = new URL(
    spaceEntryUrl({ host: "notes.test", prefix: "/work" }, true),
  );
  expect(encrypted.searchParams.get("destination")).toBe(
    "https://notes.test/work/",
  );
});

test("space entry preserves an explicitly configured destination port", async () => {
  (globalThis as any).location = {
    port: "3000",
    href: "https://login.sb.test:3000/.dashboard/",
  };
  const { spaceEntryUrl } = await import("./bindings.ts");
  const encrypted = new URL(
    spaceEntryUrl({ host: "notes.test:4100", prefix: "/work" }, true),
  );
  expect(encrypted.searchParams.get("destination")).toBe(
    "https://notes.test:4100/work/",
  );
});
