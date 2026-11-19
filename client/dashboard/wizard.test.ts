import { expect, test } from "vitest";
import {
  DEFAULT_STARTER,
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
  starter: DEFAULT_STARTER,
};

const KIT_STARTER = {
  type: "kit",
  id: "personal-space",
};

test("defaultFolder slugifies the name under <root>/spaces", () => {
  expect(defaultFolder("/data", "My Notes")).toBe("/data/spaces/my-notes");
});

test("parentDir bottoms out at the root rather than returning empty", () => {
  expect(parentDir("/notes")).toBe("/");
  expect(parentDir("/")).toBe("/");
});

test("validateAdmin accepts a complete, matching account", () => {
  expect(validateAdmin(ADMIN)).toEqual([]);
});

test("validateAdmin rejects a mismatched repeat", () => {
  expect(validateAdmin({ ...ADMIN, password2: "hunter3" })).toEqual([
    { field: "adminPassword2", message: "Passwords do not match" },
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
  ).toEqual([{ field: "adminUsername", message: "Required" }]);
});

test("validateSpace accepts a complete prefix-bound space", () => {
  expect(validateSpace(SPACE)).toEqual([]);
});

test("spacePayload serializes a primary-host prefix", () => {
  expect(spacePayload(SPACE)).toEqual({
    name: "Notes",
    prefix: "/notes",
    folder: "/data/spaces/notes",
    revisions: "managed",
    starter: KIT_STARTER,
  });

  expect(
    spacePayload({ ...SPACE, binding: { host: "notes.example.com" } }),
  ).toEqual({
    name: "Notes",
    host: "notes.example.com",
    prefix: "/",
    folder: "/data/spaces/notes",
    revisions: "managed",
    starter: KIT_STARTER,
  });
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
    starter: KIT_STARTER,
  });
  expect(spacePayload({ ...SPACE, revisions: "unmanaged" }).revisions).toBe(
    "unmanaged",
  );
});

test("spacePayload defaults to the Personal space kit", () => {
  expect(spacePayload(SPACE).starter).toEqual(KIT_STARTER);
});

test("spacePayload carries the chosen kit", () => {
  const starter = {
    ...DEFAULT_STARTER,
    choice: { type: "kit" as const, id: "blank-space" },
  };
  expect(spacePayload({ ...SPACE, starter }).starter).toEqual({
    type: "kit",
    id: "blank-space",
  });
});

test("spacePayload sends a Git starting point as a one-off copy", () => {
  const starter = {
    ...DEFAULT_STARTER,
    choice: { type: "git" as const },
    gitUrl: " https://github.com/example/notes ",
  };
  expect(spacePayload({ ...SPACE, starter }).starter).toEqual({
    type: "git",
    url: "https://github.com/example/notes",
  });
});

test("spacePayload sends no starter content over a folder with notes", () => {
  const starter = { ...DEFAULT_STARTER, hasNotes: true };
  expect(spacePayload({ ...SPACE, starter }).starter).toEqual({
    type: "none",
  });
});

test("validateSpace requires a Git URL once Git is chosen", () => {
  const starter = { ...DEFAULT_STARTER, choice: { type: "git" as const } };
  expect(validateSpace({ ...SPACE, starter })).toEqual([
    { field: "space.gitUrl", message: "Required" },
  ]);
});
