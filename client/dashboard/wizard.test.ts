import { expect, test } from "vitest";
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

test("spacePayload serializes a primary-host prefix", () => {
  expect(spacePayload(SPACE)).toEqual({
    name: "Notes",
    prefix: "/notes",
    folder: "/data/spaces/notes",
    revisions: "managed",
  });

  expect(
    spacePayload({ ...SPACE, binding: { host: "notes.example.com" } }),
  ).toEqual({
    name: "Notes",
    host: "notes.example.com",
    prefix: "/",
    folder: "/data/spaces/notes",
    revisions: "managed",
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
  });
  expect(spacePayload({ ...SPACE, revisions: "unmanaged" }).revisions).toBe(
    "unmanaged",
  );
});
