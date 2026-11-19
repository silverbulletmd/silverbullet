// @vitest-environment happy-dom
import { h, render } from "preact";
import { expect, test } from "vitest";
import { useFullIcons } from "../../../plug-api/ui/icons/test_icons.ts";
import { TagIcon } from "./tag_list_view.tsx";

test("a tag icon resolves Feather-era names through Lucide aliases", () => {
  useFullIcons();
  const root = document.createElement("div");
  render(h(TagIcon, { icon: "check-square" }), root);
  expect(root.querySelector("svg.lucide-square-check-big")).not.toBeNull();
});
