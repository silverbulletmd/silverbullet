import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import { expect, test } from "vitest";
import { type ShownValue, widgetCaps } from "./lua_widget.ts";

const shown: ShownValue = {
  kind: "markdown",
  bakeable: true,
  copyable: true,
  luaError: false,
};
const env = { readOnly: false };
const ref = { path: "Library/Sketch.md" } as Ref;

test("a ${…} directive offers everything", () => {
  expect(widgetCaps({ kind: "directive", wrappers: [] }, shown, env)).toEqual({
    definition: false,
    open: false,
    edit: true,
    query: false,
    copy: true,
    bake: true,
  });
});

test("a query[[…]] directive can be opened in the query builder", () => {
  const d = { kind: "directive" as const, wrappers: [] };
  const q = 'query[[from t = index.tag "task"]]';
  expect(widgetCaps(d, shown, { ...env, expression: q }).query).toBe(true);
  expect(widgetCaps(d, shown, { ...env, expression: ` ${q}` }).query).toBe(
    true,
  );
  expect(widgetCaps(d, shown, { ...env, expression: "1 + 1" }).query).toBe(
    false,
  );
  // Not when read-only, nor for an assignment, whose name would be lost
  expect(widgetCaps(d, shown, { readOnly: true, expression: q }).query).toBe(
    false,
  );
  expect(
    widgetCaps({ ...d, label: "open" }, shown, { ...env, expression: q }).query,
  ).toBe(false);
});

test("read-only keeps Copy and drops editing", () => {
  const caps = widgetCaps({ kind: "directive", wrappers: [] }, shown, {
    ...env,
    readOnly: true,
  });
  expect(caps).toMatchObject({ edit: false, copy: true, bake: false });
});

test("each host's own rules", () => {
  expect(widgetCaps({ kind: "code", codeText: "x" }, shown, env)).toMatchObject(
    {
      bake: false,
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

test("an error, a view", () => {
  const d = { kind: "directive" as const, wrappers: [] };
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
