import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import { expect, test } from "vitest";
import { type ShownValue, shownCaps, widgetCaps } from "./lua_widget.ts";

const shown: ShownValue = {
  kind: "markdown",
  bakeable: true,
  copyable: true,
  luaError: false,
};
const env = { readOnly: false };
const ref = { path: "Library/Sketch.md" } as Ref;

test("read-only keeps Copy and drops editing", () => {
  const code = { kind: "code" as const, codeText: "x" };
  expect(widgetCaps(code, shown, env)).toEqual({
    definition: false,
    open: false,
    edit: true,
    copy: true,
    remove: false,
  });
  expect(widgetCaps(code, shown, { readOnly: true })).toMatchObject({
    edit: false,
    copy: true,
  });
});

test("each host's own rules", () => {
  expect(
    widgetCaps(
      { kind: "transclusion", codeText: "x", openRef: ref },
      shown,
      env,
    ),
  ).toMatchObject({ open: true });
  expect(
    widgetCaps(
      { kind: "object", editPos: () => 4, definitionRef: ref },
      shown,
      env,
    ),
  ).toMatchObject({ definition: true, copy: false, edit: true, remove: false });
  // Only an object that can be deleted, and not read-only
  const frontmatter = {
    kind: "object" as const,
    editPos: () => 4,
    definitionRef: null,
    remove: async () => {},
  };
  expect(widgetCaps(frontmatter, shown, env).remove).toBe(true);
  expect(
    widgetCaps(frontmatter, shown, { ...env, readOnly: true }).remove,
  ).toBe(false);
  expect(
    widgetCaps({ kind: "panel", definitionRef: ref }, shown, env),
  ).toMatchObject({ definition: true, edit: false });
});

test("a ${…}'s shown value: an error, a view", () => {
  expect(shownCaps(shown)).toEqual({ copy: true, bake: true });
  expect(shownCaps({ ...shown, luaError: true })).toEqual({
    copy: true,
    bake: false,
  });
  // A list view copies its rows; a content view has no Copy; neither bakes
  const view = (rows: boolean): ShownValue => ({
    ...shown,
    kind: "view",
    bakeable: false,
    copyable: rows,
  });
  expect(shownCaps(view(true))).toEqual({ copy: true, bake: false });
  expect(shownCaps(view(false))).toEqual({ copy: false, bake: false });
  expect(shownCaps({ ...shown, copyable: false })).toEqual({
    copy: false,
    bake: true,
  });
});
