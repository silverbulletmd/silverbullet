import { expect, test } from "vitest";
import {
  bindingFromAddress,
  bindingHostOptions,
  bindingPrefix,
  createBindingDraft,
  customHostOrigin,
  hostOptions,
  resolvePublicOrigin,
  selectBindingHost,
  validHostAuthority,
} from "./binding_fields.ts";

test("hostname validation accepts DNS and IPv4 authorities with optional ports", () => {
  for (const host of [
    "localhost",
    "notes.home",
    "127.0.0.1",
    "Notes.Example.test.",
    "notes.home:3000",
    "127.0.0.1:8080",
    "Notes.Example.test.:443",
  ])
    expect(validHostAuthority(host)).toBe(true);
  for (const host of [
    ".",
    " notes.test",
    "notes.test ",
    "notes\\evil.test",
    "notes.test?x",
    "notes.test#x",
    "user@notes.test",
    "-notes.test",
    "notes-.test",
    "notes..test",
    "notes_test",
    "999.1.1.1",
    "001.2.3.4",
    "[::1]",
    "127.1",
    "2130706433",
    "0x7f000001",
    "123",
    "notes.test:",
    "notes.test:0",
    "notes.test:65536",
    "notes.test:03000",
    "notes.test:port",
  ])
    expect(validHostAuthority(host)).toBe(false);
});
import type { Binding, VisibleSpace } from "./types.ts";

function space(id: string, binding: Binding): VisibleSpace {
  return { id, name: id, binding, access: "read" };
}

test("bindingPrefix presents missing and root prefixes as a root path", () => {
  expect(bindingPrefix({ host: "notes.test" })).toBe("/");
  expect(bindingPrefix({ prefix: "" })).toBe("/");
  expect(bindingPrefix({ prefix: "/" })).toBe("/");
});

test("hostname switches retain independent primary, known-host, and new-host paths", () => {
  let draft = createBindingDraft({ prefix: "/reading" });
  let result = selectBindingHost(draft, { prefix: "/reading" }, "Team.Test.");
  expect(result.binding).toEqual({ host: "Team.Test." });
  expect(result.draft.choice).toBe("host:team.test");
  result = selectBindingHost(
    result.draft,
    { host: "Team.Test.", prefix: "/notes" },
    undefined,
  );
  expect(result.binding).toEqual({ host: "" });
  draft = { ...result.draft, newHost: "fresh.test" };
  result = selectBindingHost(
    draft,
    { host: "fresh.test", prefix: "/draft" },
    null,
  );
  expect(result.binding).toEqual({ prefix: "/reading" });
  result = selectBindingHost(result.draft, result.binding, "TEAM.TEST");
  expect(result.binding).toEqual({ host: "TEAM.TEST", prefix: "/notes" });
  result = selectBindingHost(result.draft, result.binding, undefined);
  expect(result.binding).toEqual({ host: "fresh.test", prefix: "/draft" });
});

test("empty primary drafts and edited host roots survive switches without rewriting the active binding", () => {
  const binding = { host: "root.test" };
  const draft = createBindingDraft(binding);
  expect(draft.choice).toBe("host:root.test");
  const primary = selectBindingHost(draft, binding, null);
  expect(primary.binding).toEqual({ prefix: "/" });
  const host = selectBindingHost(primary.draft, { prefix: "" }, "root.test");
  expect(host.binding).toEqual({ host: "root.test" });
  expect(selectBindingHost(host.draft, host.binding, null).binding).toEqual({
    prefix: "",
  });
});

test("single-label hostnames do not collide with the Primary and New choices or object keys", () => {
  let result = selectBindingHost(
    createBindingDraft({ prefix: "/work" }),
    { prefix: "/work" },
    "new",
  );
  expect(result.draft.choice).toBe("host:new");
  expect(result.binding).toEqual({ host: "new" });
  result = selectBindingHost(result.draft, result.binding, "constructor");
  expect(result.binding).toEqual({ host: "constructor" });
  result = selectBindingHost(result.draft, result.binding, "primary");
  expect(result.draft.choice).toBe("host:primary");
  expect(result.binding).toEqual({ host: "primary" });
});

test("bindingFromAddress preserves a supplied hostname and non-root path", () => {
  expect(bindingFromAddress("notes.test", "/work")).toEqual({
    host: "notes.test",
    prefix: "/work",
  });
});

test("bindingFromAddress compacts a hostname root to a host-only binding", () => {
  expect(bindingFromAddress("notes.test", "/")).toEqual({
    host: "notes.test",
  });
});

test("bindingFromAddress keeps a prefix-only address prefix-only", () => {
  expect(bindingFromAddress(null, "/work")).toEqual({ prefix: "/work" });
});

test("resolvePublicOrigin falls back while the controlled Primary URL is blank or partial", () => {
  const fallback = "http://localhost:3000";
  expect(resolvePublicOrigin("", fallback)).toEqual({
    origin: fallback,
    host: "localhost:3000",
    hostname: "localhost",
    protocol: "http:",
    port: "3000",
  });
  expect(resolvePublicOrigin("https://", fallback)).toEqual({
    origin: fallback,
    host: "localhost:3000",
    hostname: "localhost",
    protocol: "http:",
    port: "3000",
  });
});

test("custom hostname origins use the Primary URL scheme without inheriting its port", () => {
  expect(
    customHostOrigin(
      "notes.example.com",
      resolvePublicOrigin(
        "https://dashboard.example.com:8443/admin",
        "http://localhost:3000",
      ),
    ),
  ).toBe("https://notes.example.com");
  expect(
    customHostOrigin(
      "notes.example.com:3000",
      resolvePublicOrigin(
        "https://dashboard.example.com:443",
        "http://localhost:3000",
      ),
    ),
  ).toBe("https://notes.example.com:3000");
});

test("hostOptions combines equivalent host spellings with deduplicated sorted occupied paths", () => {
  expect(
    hostOptions([
      space("work", { host: "Team.Example.com.", prefix: "/work" }),
      space("wiki", { host: "team.example.com", prefix: "/wiki" }),
      space("root", { host: "team.example.com" }),
      space("other-root", { host: "team.example.com", prefix: "" }),
    ]),
  ).toEqual([
    {
      host: "team.example.com",
      displayHost: "Team.Example.com",
      prefixes: ["/", "/wiki", "/work"],
      rootOccupied: true,
      label: "Team.Example.com — /, /wiki, /work",
    },
  ]);
});

test("hostOptions keeps an edited hostname selectable when it has no other paths", () => {
  expect(
    hostOptions(
      [space("work", { host: "team.test", prefix: "/work" })],
      "work",
    ),
  ).toEqual([
    {
      host: "team.test",
      displayHost: "team.test",
      prefixes: [],
      rootOccupied: false,
      label: "team.test",
    },
  ]);
});

test("hostOptions excludes the edited space from occupancy", () => {
  expect(
    hostOptions(
      [
        space("root", { host: "team.test" }),
        space("work", { host: "team.test", prefix: "/work" }),
      ],
      "root",
    ),
  ).toEqual([
    {
      host: "team.test",
      displayHost: "team.test",
      prefixes: ["/work"],
      rootOccupied: false,
      label: "team.test — /work",
    },
  ]);
});

test("hostOptions marks a hostname with an occupied root as unavailable for another mapping", () => {
  expect(hostOptions([space("root", { host: "team.test" })])).toEqual([
    {
      host: "team.test",
      displayHost: "team.test",
      prefixes: ["/"],
      rootOccupied: true,
      label: "team.test — /",
    },
  ]);
});

test("hostOptions keeps identical paths on distinct hosts separate", () => {
  expect(
    hostOptions([
      space("other", { host: "other.test", prefix: "/work" }),
      space("team", { host: "team.test", prefix: "/work" }),
    ]),
  ).toEqual([
    {
      host: "other.test",
      displayHost: "other.test",
      prefixes: ["/work"],
      rootOccupied: false,
      label: "other.test — /work",
    },
    {
      host: "team.test",
      displayHost: "team.test",
      prefixes: ["/work"],
      rootOccupied: false,
      label: "team.test — /work",
    },
  ]);
});

test("hostOptions keeps bare and explicitly ported hostnames separate", () => {
  expect(
    hostOptions([
      space("default-port", { host: "team.test", prefix: "/work" }),
      space("custom-port", { host: "TEAM.TEST:3000", prefix: "/wiki" }),
    ]).map((option) => ({ host: option.host, prefixes: option.prefixes })),
  ).toEqual([
    { host: "team.test", prefixes: ["/work"] },
    { host: "team.test:3000", prefixes: ["/wiki"] },
  ]);
});

test("hostOptions folds explicit Primary-host bindings into Primary occupancy", () => {
  const spaces = [
    space("implicit", { prefix: "/notes" }),
    space("explicit", {
      host: "DASHBOARD.EXAMPLE.TEST.:8443",
      prefix: "/wiki",
    }),
    space("root", { host: "dashboard.example.test:8443" }),
    space("team", { host: "team.example.test", prefix: "/work" }),
  ];
  const result = bindingHostOptions(
    spaces,
    "dashboard.example.test:8443",
    "implicit",
  );
  expect(result.primary.prefixes).toEqual(["/", "/wiki"]);
  expect(result.custom.map((option) => option.host)).toEqual([
    "team.example.test",
  ]);
});
