import { expect, test } from "vitest";
import { matchesNodeContexts } from "./node_contexts.ts";

const inOutline = ["Paragraph", "ListItem", "BulletList", "Document"];
const inLuaBlock = ["CodeText", "FencedCode:lua\nx = 1", "Document"];

test("no filter matches everywhere", () => {
  expect(matchesNodeContexts({}, inOutline)).toBe(true);
  expect(matchesNodeContexts({}, [])).toBe(true);
});

test("onlyContexts requires an enclosing node", () => {
  expect(matchesNodeContexts({ onlyContexts: ["ListItem"] }, inOutline)).toBe(
    true,
  );
  expect(
    matchesNodeContexts({ onlyContexts: ["ListItem"] }, ["Paragraph"]),
  ).toBe(false);
});

test("exceptContexts excludes enclosing nodes", () => {
  expect(
    matchesNodeContexts({ exceptContexts: ["FencedCode"] }, inLuaBlock),
  ).toBe(false);
  expect(
    matchesNodeContexts({ exceptContexts: ["FencedCode"] }, inOutline),
  ).toBe(true);
});

test("contexts match by prefix, including a fenced code language", () => {
  expect(
    matchesNodeContexts({ onlyContexts: ["FencedCode:lua"] }, inLuaBlock),
  ).toBe(true);
  expect(
    matchesNodeContexts({ onlyContexts: ["FencedCode:js"] }, inLuaBlock),
  ).toBe(false);
});
