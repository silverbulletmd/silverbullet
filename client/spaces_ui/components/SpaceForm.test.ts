import { h } from "preact";
import { render } from "preact-render-to-string";
import { afterEach, expect, test } from "vitest";
import type { SpaceInfo, VisibleSpace } from "../types.ts";
import { settingsPayload } from "../space_settings.ts";
import { BindingFields } from "./BindingFields.tsx";
import { SpaceForm } from "./SpaceForm.tsx";

const location = {
  origin: "http://localhost:3000",
  protocol: "http:",
  port: "3000",
};
afterEach(() => {
  delete (globalThis as any).location;
});

test("new spaces start with managed revisions and shell commands disabled", () => {
  (globalThis as any).location = location;
  const html = render(
    h(SpaceForm, {
      onSaved: () => {},
      cancelHref: "/.spaces/",
      onDeleted: () => {},
      onUnauthorized: () => {},
    }),
  );
  expect(html).toMatch(/<option[^>]*selected[^>]*value="managed"[^>]*>/);
  expect(html).toMatch(
    /<h3>Shell commands<\/h3><label><input(?![^>]*checked)[^>]*type="checkbox"[^>]*>/,
  );
  expect(html).toContain("Primary hostname — localhost:3000");
  expect(html).toContain("New hostname");
});

const spaces: VisibleSpace[] = [
  {
    id: "wiki",
    name: "Wiki",
    binding: { host: "team.test", prefix: "/wiki" },
    access: "none",
  },
  {
    id: "work",
    name: "Work",
    binding: { host: "TEAM.TEST.", prefix: "/work" },
    access: "none",
  },
  { id: "root", name: "Root", binding: { host: "root.test" }, access: "none" },
];

test("the hostname field renders distinct known hosts and disables occupied roots", () => {
  (globalThis as any).location = location;
  const html = render(
    h(BindingFields, {
      binding: { prefix: "/notes" },
      primaryUrl: "https://primary.test:8443",
      spaces,
      onInput: () => {},
    }),
  );
  expect(html).toContain("Primary hostname — primary.test:8443");
  expect(html).toContain("New hostname");
  expect(html).toContain("team.test — /wiki, /work");
  expect(html.match(/value="host:team.test"/g)).toHaveLength(1);
  expect(html).toMatch(
    /<option[^>]*value="host:root.test"[^>]*disabled[^>]*>root.test — \/<\/option>/,
  );
});

test("the path editor does not repeat its composed URL below the field", () => {
  (globalThis as any).location = location;
  const html = render(
    h(BindingFields, {
      binding: { host: "team.test", prefix: "/work" },
      spaces,
      onInput: () => {},
    }),
  );
  expect(html).not.toContain("<output>");
});

test("Primary hostname shows effective occupied paths without a duplicate custom option", () => {
  (globalThis as any).location = location;
  const html = render(
    h(BindingFields, {
      binding: { prefix: "/new" },
      spaces: [
        {
          id: "root",
          name: "Root",
          binding: { host: "PRIMARY.test" },
          access: "none",
        },
        {
          id: "notes",
          name: "Notes",
          binding: { prefix: "/notes" },
          access: "none",
        },
      ],
      primaryUrl: "https://primary.test",
      onInput: () => {},
    }),
  );
  expect(html).toContain("Primary hostname — primary.test — /, /notes");
  expect(html).toMatch(
    /<option[^>]*value="primary"[^>]*disabled[^>]*>Primary hostname/,
  );
  expect(html.match(/host:primary\.test/g)).toBeNull();
});

test("editing a bare host keeps it selectable and uses the default port", () => {
  (globalThis as any).location = location;
  const html = render(
    h(BindingFields, {
      binding: { host: "root.test" },
      spaces,
      currentId: "root",
      onInput: () => {},
    }),
  );
  expect(html).toMatch(
    /<option(?=[^>]*value="host:root.test")(?=[^>]*selected)(?![^>]*disabled)[^>]*>root.test<\/option>/,
  );
  expect(html).toContain('class="sb-url-affix">http://root.test</span>');
});

test("an edited hostname with a port remains available when the advisory list is unavailable", () => {
  (globalThis as any).location = location;
  const html = render(
    h(BindingFields, {
      binding: { host: "team.test:4100", prefix: "/work" },
      spaces: [],
      currentId: "work",
      onInput: () => {},
    }),
  );
  expect(html).toContain("team.test:4100</option>");
  expect(html).toContain('class="sb-url-affix">http://team.test:4100</span>');
});

test("a grandfathered prefixed participant can retain its current host while other occupied roots stay disabled", () => {
  (globalThis as any).location = location;
  const html = render(
    h(BindingFields, {
      binding: { host: "TEAM.TEST.", prefix: "/work" },
      currentId: "work",
      spaces: [
        ...spaces,
        {
          id: "team-root",
          name: "Team root",
          binding: { host: "team.test" },
          access: "none",
        },
      ],
      onInput: () => {},
    }),
  );
  expect(html).toMatch(
    /<option(?=[^>]*value="host:team.test")(?=[^>]*selected)(?![^>]*disabled)[^>]*>team.test — \/, \/wiki<\/option>/,
  );
  expect(html).toMatch(
    /<option[^>]*value="host:root.test"[^>]*disabled[^>]*>root.test — \/<\/option>/,
  );
});

test("General renders the derived warning without including it in its saved fields", () => {
  (globalThis as any).location = location;
  const initial: SpaceInfo = {
    name: "Work",
    folder: "spaces/work",
    binding: { host: "team.test", prefix: "/work" },
    bindingWarning: "Root and prefixed bindings share team.test.",
    access: "none",
    members: {},
    readOnly: false,
    shell: { enabled: false, whitelist: [] },
    indexPage: "index",
    status: { state: "running" },
  };
  const html = render(
    h(SpaceForm, {
      id: "work",
      initial,
      onSaved: () => {},
      cancelHref: "/.spaces/",
      onDeleted: () => {},
      onUnauthorized: () => {},
    }),
  );
  expect(html).toContain(`sb-alert-warning">${initial.bindingWarning}</div>`);
  expect(settingsPayload(initial, "general")).toEqual({
    name: "Work",
    folder: "spaces/work",
    binding: { host: "team.test", prefix: "/work" },
    indexPage: "index",
  });
  expect(settingsPayload(initial, "general")).toEqual(
    settingsPayload({ ...initial, bindingWarning: undefined }, "general"),
  );
});
