import { expect, test } from "vitest";
import {
  defaultFolder,
  parentDir,
  spacePayload,
  targetUrl,
  validateAdmin,
  validateSpace,
} from "./wizard.ts";

const ADMIN = { username: "alice", password: "hunter2", password2: "hunter2" };
const SPACE = {
  name: "Notes",
  hosting: "prefix" as const,
  prefix: "/notes",
  folder: "/data/spaces/notes",
};

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

test("targetUrl wraps a prefix in slashes", () => {
  expect(targetUrl("prefix", "notes")).toBe("/notes/");
});

test("targetUrl normalizes a prefix that already has slashes", () => {
  expect(targetUrl("prefix", "/notes/")).toBe("/notes/");
});

test("targetUrl is the bare root when hosting at the root", () => {
  // The prefix field keeps its value when the radio flips to "root", so a
  // stale prefix must not leak into the URL we poll and navigate to.
  expect(targetUrl("root", "/notes")).toBe("/");
});

test("targetUrl collapses a blank prefix to the root instead of //", () => {
  expect(targetUrl("prefix", "   ")).toBe("/");
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
  expect(validateAdmin({ username: "", password: "", password2: "x" })).toEqual(
    [{ field: "adminUsername", message: "username is required" }],
  );
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
  // A prefix-bound space with an empty prefix would bind to the bare root and
  // capture every URL on the server.
  expect(validateSpace({ ...SPACE, prefix: "  " })).toEqual([
    { field: "space.prefix", message: "prefix is required" },
  ]);
});

test("validateSpace ignores a blank prefix when hosting at the root", () => {
  expect(validateSpace({ ...SPACE, hosting: "root", prefix: "" })).toEqual([]);
});

test("validateSpace rejects a blank folder", () => {
  expect(validateSpace({ ...SPACE, folder: "" })).toEqual([
    { field: "space.folder", message: "folder is required" },
  ]);
});

test("spacePayload passes a prefix-bound space through unchanged", () => {
  expect(spacePayload(SPACE)).toEqual({
    name: "Notes",
    prefix: "/notes",
    folder: "/data/spaces/notes",
  });
});

test("spacePayload sends the root binding, not a stale prefix", () => {
  expect(spacePayload({ ...SPACE, hosting: "root" })).toEqual({
    name: "Notes",
    prefix: "/",
    folder: "/data/spaces/notes",
  });
});
