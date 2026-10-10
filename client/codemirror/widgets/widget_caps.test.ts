import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import { expect, test } from "vitest";
import { type ShownValue, widgetCaps } from "./lua_widget.ts";

const shown: ShownValue = {
  kind: "markdown",
  bakeable: true,
  copyable: true,
  luaError: false,
};
const env = { readOnly: false, expr: "q()" };
const ref = { path: "Library/Sketch.md" } as Ref;

test("a ${…} directive offers everything", () => {
  expect(widgetCaps({ kind: "directive", wrappers: [] }, shown, env)).toEqual({
    definition: false,
    open: false,
    edit: true,
    live: undefined,
    copy: true,
    bake: true,
    toggleLive: "makeLive",
  });
});

test("read-only keeps Copy and drops editing", () => {
  const caps = widgetCaps({ kind: "directive", wrappers: [] }, shown, {
    ...env,
    readOnly: true,
  });
  expect(caps).toMatchObject({ edit: false, copy: true, bake: false });
  expect(caps.toggleLive).toBeUndefined();
});

test("each host's own rules", () => {
  expect(widgetCaps({ kind: "code", codeText: "x" }, shown, env)).toMatchObject(
    {
      bake: false,
      toggleLive: undefined,
      edit: true,
    },
  );
  expect(
    widgetCaps(
      { kind: "transclusion", codeText: "x", openRef: ref },
      shown,
      env,
    ),
  ).toMatchObject({ open: true });
  expect(
    widgetCaps(
      { kind: "frontmatter", editPos: 4, definitionRef: ref },
      shown,
      env,
    ),
  ).toMatchObject({ definition: true, copy: false, edit: true });
  expect(
    widgetCaps({ kind: "panel", definitionRef: ref }, shown, env),
  ).toMatchObject({ definition: true, edit: false });
});

test("a live value, a nested-live value, an error, a view", () => {
  const d = { kind: "directive" as const, wrappers: [] };
  expect(
    widgetCaps(
      d,
      { ...shown, live: ["edit"] },
      { ...env, expr: 'widget.live(q(), { "edit" })' },
    ),
  ).toMatchObject({ live: ["edit"], toggleLive: "makeStatic" });
  expect(
    widgetCaps(
      d,
      { ...shown, live: ["index"] },
      { ...env, expr: "{ widget.live(q()), 1 }" },
    ).toggleLive,
  ).toBeUndefined();
  expect(widgetCaps(d, { ...shown, luaError: true }, env)).toMatchObject({
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
  expect(widgetCaps(d, view(true), env)).toMatchObject({
    copy: true,
    bake: false,
    toggleLive: undefined,
  });
  expect(widgetCaps(d, view(false), env)).toMatchObject({
    copy: false,
    bake: false,
  });
  expect(widgetCaps(d, { ...shown, copyable: false }, env)).toMatchObject({
    copy: false,
    bake: true,
  });
});
