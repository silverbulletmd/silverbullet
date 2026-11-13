// @vitest-environment happy-dom
import { expect, test } from "vitest";
import type { Client } from "../../client.ts";
import type { PopupEntry } from "../../components/popup_menu.ts";
import {
  type DirectiveMenuCaps,
  directiveMenuCaps,
  directiveMenuEntries,
} from "./directive_menu.ts";

const labels = (entries: PopupEntry[]) =>
  entries.map((e) =>
    e.kind === "separator" ? "—" : e.kind === "info" ? e.text : e.label,
  );

const all: DirectiveMenuCaps = {
  edit: true,
  query: true,
  bake: true,
  copy: true,
};

test("rendered: Edit source, query builder, Bake, Copy", () => {
  expect(labels(directiveMenuEntries("rendered", all))).toEqual([
    "Edit source",
    "Edit in query builder",
    "—",
    "Bake into page",
    "Copy as Markdown",
  ]);
});

test("editing: Show result first, and no Copy", () => {
  expect(labels(directiveMenuEntries("editing", all))).toEqual([
    "Show result",
    "Edit in query builder",
    "—",
    "Bake into page",
  ]);
});

test("a non-query expression has no query builder", () => {
  expect(
    labels(directiveMenuEntries("rendered", { ...all, query: false })),
  ).toEqual(["Edit source", "—", "Bake into page", "Copy as Markdown"]);
});

test("read-only leaves only Copy", () => {
  expect(
    labels(directiveMenuEntries("rendered", { ...all, edit: false })),
  ).toEqual(["Copy as Markdown"]);
});

test("caps: a query[[…]] opens in the query builder; an assignment neither does nor bakes", () => {
  const client = (readOnly = false) =>
    ({ isReadOnlyMode: () => readOnly }) as unknown as Client;
  const caps = (expr: string, assignmentName?: string, readOnly = false) =>
    directiveMenuCaps(
      client(readOnly),
      { expr, assignmentName },
      { copy: true, bake: true },
    );
  const q = 'query[[from t = index.tag "task"]]';
  expect(caps(q).query).toBe(true);
  expect(caps(` ${q}`).query).toBe(true);
  expect(caps("1 + 2").query).toBe(false);
  expect(caps(q, "open")).toMatchObject({ query: false, bake: false });
  expect(caps("1", undefined, true).edit).toBe(false);
});
