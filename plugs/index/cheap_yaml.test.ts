import { expect, test } from "vitest";
import { determineTags } from "./cheap_yaml.ts";

test("cheap yaml", () => {
  expect(determineTags("")).toEqual([]);
  expect(determineTags("hank: bla")).toEqual([]);
  expect(determineTags("tags: template")).toEqual(["template"]);
  expect(determineTags("tags: bla,template")).toEqual(["bla", "template"]);
  expect(determineTags("tags:\n- bla\n- template")).toEqual(["bla", "template"]);
  expect(determineTags(`tags: "#bla,#template"`)).toEqual(["bla", "template"]);
  expect(determineTags(`tags: '#bla, #template'`)).toEqual(["bla", "template"]);
  expect(determineTags(`tags:\n- "#bla"\n- template`)).toEqual(["bla", "template"]);
});
