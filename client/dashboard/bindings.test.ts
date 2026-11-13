import { afterEach, expect, test } from "vitest";
import { bindingLabel, spaceUrl } from "./bindings.ts";

afterEach(() => {
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).location;
});

// A bare "/" prefix must stay "/" (appending another slash would produce an
// invalid protocol-relative "//" URL); a host binding never gains the listener
// port, only one it spells out itself.
test.each([
  [{ prefix: "" }, "/"],
  [{ prefix: "/" }, "/"],
  [{ prefix: "/foo" }, "/foo/"],
  [{ prefix: "/foo/" }, "/foo/"],
  [{ host: "team.test", prefix: "/work" }, "//team.test/work/"],
  [{ host: "team.test:4100", prefix: "/work" }, "//team.test:4100/work/"],
])("spaceUrl %j is %s", (binding, expected) => {
  expect(spaceUrl(binding)).toBe(expected);
});

test.each([
  [{ prefix: "" }, "/"],
  [{ prefix: "/" }, "/"],
  [{ host: "team.test", prefix: "/work" }, "team.test/work"],
  [{ host: "team.test:4100", prefix: "/work" }, "team.test:4100/work"],
])("bindingLabel %j is %s", (binding, expected) => {
  expect(bindingLabel(binding)).toBe(expected);
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
