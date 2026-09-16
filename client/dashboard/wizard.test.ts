import { h } from "preact";
import { render } from "preact-render-to-string";
import { afterEach, expect, test } from "vitest";
import { SpaceStep } from "./components/wizard/SpaceStep.tsx";
import type { Binding } from "./types.ts";
import {
  defaultFolder,
  parentDir,
  spacePayload,
  validateAdmin,
  validateSpace,
} from "./wizard.ts";

const ADMIN = {
  username: "alice",
  password: "hunter2",
  password2: "hunter2",
  fullName: "",
  email: "",
};
const SPACE = {
  name: "Notes",
  binding: { prefix: "/notes" },
  folder: "/data/spaces/notes",
  revisions: "managed" as const,
};

afterEach(() => {
  delete (globalThis as any).location;
});

function renderSpaceStep(primaryUrl: string, binding: Binding = SPACE.binding) {
  (globalThis as any).location = {
    origin: "http://localhost:3000",
    protocol: "http:",
    port: "3000",
  };
  return render(
    h(SpaceStep, {
      values: { ...SPACE, binding },
      root: "/data",
      onNameInput: () => {},
      primaryUrl,
      onPrimaryUrlChange: () => {},
      onBindingChange: () => {},
      onFolderChange: () => {},
      onRevisionsChange: () => {},
      errors: [],
      busy: false,
      onBack: () => {},
      onSubmit: () => {},
    }),
  );
}

test("defaultFolder slugifies the name under <root>/spaces", () => {
  expect(defaultFolder("/data", "My Notes")).toBe("/data/spaces/my-notes");
});

test("defaultFolder does not double up a trailing slash on the root", () => {
  expect(defaultFolder("/data/", "Notes")).toBe("/data/spaces/notes");
});

test("parentDir walks up one level", () => {
  expect(parentDir("/data/spaces/notes")).toBe("/data/spaces");
});

test("parentDir ignores a trailing slash", () => {
  expect(parentDir("/data/spaces/notes/")).toBe("/data/spaces");
});

test("parentDir bottoms out at the root rather than returning empty", () => {
  expect(parentDir("/notes")).toBe("/");
  expect(parentDir("/")).toBe("/");
});

test("the setup binding follows the edited Primary URL without changing its path", () => {
  const first = renderSpaceStep("https://first.example.com");
  const second = renderSpaceStep("https://second.example.com:8443");

  expect(first).toContain("Primary hostname — first.example.com");
  expect(first).toContain(
    'class="sb-url-affix">https://first.example.com</span>',
  );
  expect(first).toContain('id="space-binding-path" value="/notes"');
  expect(second).toContain("Primary hostname — second.example.com:8443");
  expect(second).toContain(
    'class="sb-url-affix">https://second.example.com:8443</span>',
  );
  expect(second).toContain('id="space-binding-path" value="/notes"');
});

test("blank and partial Primary URL edits keep the binding controls renderable with the listener fallback", () => {
  const blank = renderSpaceStep("");
  const partial = renderSpaceStep("https://");

  expect(blank).toContain("Primary hostname — localhost:3000");
  expect(blank).toContain('class="sb-url-affix">http://localhost:3000</span>');
  expect(partial).toContain("Primary hostname — localhost:3000");
  expect(partial).toContain(
    'class="sb-url-affix">http://localhost:3000</span>',
  );
});

test("setup custom-host origins inherit only the Primary URL scheme", () => {
  const bare = renderSpaceStep("https://dashboard.example.com:8443", {
    host: "notes.example.com",
    prefix: "/work",
  });
  const explicitPort = renderSpaceStep("https://dashboard.example.com", {
    host: "notes.example.com:3000",
    prefix: "/work",
  });

  expect(bare).toContain(
    'class="sb-url-affix">https://notes.example.com</span>',
  );
  expect(explicitPort).toContain(
    'class="sb-url-affix">https://notes.example.com:3000</span>',
  );
});

test("validateAdmin accepts a complete, matching account", () => {
  expect(validateAdmin(ADMIN)).toEqual([]);
});

test("validateAdmin rejects a blank username", () => {
  expect(validateAdmin({ ...ADMIN, username: "   " })).toEqual([
    { field: "adminUsername", message: "username is required" },
  ]);
});

test("validateAdmin rejects an empty password", () => {
  expect(validateAdmin({ ...ADMIN, password: "", password2: "" })).toEqual([
    { field: "adminPassword", message: "password is required" },
  ]);
});

test("validateAdmin rejects a mismatched repeat", () => {
  expect(validateAdmin({ ...ADMIN, password2: "hunter3" })).toEqual([
    { field: "adminPassword", message: "passwords do not match" },
  ]);
});

test("validateAdmin reports one problem at a time, in field order", () => {
  expect(
    validateAdmin({
      username: "",
      password: "",
      password2: "x",
      fullName: "",
      email: "",
    }),
  ).toEqual([{ field: "adminUsername", message: "username is required" }]);
});

test("validateSpace accepts a complete prefix-bound space", () => {
  expect(validateSpace(SPACE)).toEqual([]);
});

test("validateSpace rejects a blank name", () => {
  expect(validateSpace({ ...SPACE, name: "  " })).toEqual([
    { field: "space.name", message: "name is required" },
  ]);
});

test("validateSpace rejects a blank prefix when bound to a prefix", () => {
  expect(validateSpace({ ...SPACE, binding: { prefix: "  " } })).toEqual([
    { field: "space.prefix", message: "prefix is required" },
  ]);
});

test("validateSpace rejects a blank path for a custom hostname", () => {
  expect(
    validateSpace({
      ...SPACE,
      binding: { host: "notes.example.com", prefix: " " },
    }),
  ).toEqual([{ field: "space.prefix", message: "prefix is required" }]);
});

test("validateSpace rejects a blank folder", () => {
  expect(validateSpace({ ...SPACE, folder: "" })).toEqual([
    { field: "space.folder", message: "folder is required" },
  ]);
});

test("spacePayload serializes a primary-host prefix", () => {
  expect(spacePayload(SPACE)).toEqual({
    name: "Notes",
    prefix: "/notes",
    folder: "/data/spaces/notes",
    revisions: "managed",
  });
});

test("spacePayload serializes a custom-host root", () => {
  expect(
    spacePayload({ ...SPACE, binding: { host: "notes.example.com" } }),
  ).toEqual({
    name: "Notes",
    host: "notes.example.com",
    prefix: "/",
    folder: "/data/spaces/notes",
    revisions: "managed",
  });
});

test("spacePayload serializes a custom hostname with a prefix", () => {
  expect(
    spacePayload({
      ...SPACE,
      binding: { host: "notes.example.com", prefix: "/work" },
    }),
  ).toEqual({
    name: "Notes",
    host: "notes.example.com",
    prefix: "/work",
    folder: SPACE.folder,
    revisions: "managed",
  });
});

test("spacePayload includes a selected unmanaged revisions mode", () => {
  expect(spacePayload({ ...SPACE, revisions: "unmanaged" })).toEqual({
    name: "Notes",
    prefix: "/notes",
    folder: "/data/spaces/notes",
    revisions: "unmanaged",
  });
});

test("new hostname setup requires an explicit host", () => {
  expect(
    validateSpace({ ...SPACE, binding: { host: " ", prefix: "/" } }),
  ).toEqual([{ field: "space.host", message: "hostname is required" }]);
});
