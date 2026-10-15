import { expect, test } from "vitest";
import {
  applySpacePatch,
  SPACE_SECTIONS,
  settingsPayload,
} from "./space_settings.ts";
import type { SpaceInfo } from "./types.ts";

const space: SpaceInfo = {
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

test("a saved binding clears the old derived warning pending the authoritative refresh", () => {
  const updated = applySpacePatch(space, {
    binding: { host: "separate.test", prefix: "/work" },
  });
  expect(updated.bindingWarning).toBeUndefined();
  expect(updated.binding).toEqual({ host: "separate.test", prefix: "/work" });
  expect(updated.folder).toBe("spaces/work");
  expect(space.bindingWarning).toBe(
    "Root and prefixed bindings share team.test.",
  );
});

test("saving a section without a binding retains the known derived warning", () => {
  const updated = applySpacePatch(space, { access: "read" });
  expect(updated.bindingWarning).toBe(
    "Root and prefixed bindings share team.test.",
  );
  expect(updated.access).toBe("read");
});

test("the search section saves the semantic search choice, the advanced section the shell", () => {
  const values = {
    shell: { enabled: false, whitelist: [] },
    semanticSearch: false,
    name: "Work",
  };
  expect(settingsPayload(values, "search")).toEqual({ semanticSearch: false });
  // Checking the box again follows the server's default.
  expect(
    settingsPayload({ ...values, semanticSearch: null }, "search"),
  ).toEqual({ semanticSearch: null });
  expect(settingsPayload(values, "advanced")).toEqual({
    shell: { enabled: false, whitelist: [] },
  });
  expect(Object.keys(SPACE_SECTIONS)).toEqual([
    "general",
    "access",
    "revisions",
    "search",
    "advanced",
  ]);
});
