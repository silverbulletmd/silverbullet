// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { useFullIcons } from "../../../plug-api/ui/icons/test_icons.ts";
import { IconResolver } from "./icon_resolver.ts";

test("a row icon with an unknown prefix renders the fallback without a console error", async () => {
  useFullIcons();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const resolver = new IconResolver();
  await resolver.resolveIcons(["lucide:lock"]);
  const node = resolver.iconNode("lucide:lock");
  expect(node?.classList.contains("lucide-circle-question-mark")).toBe(true);
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
  warn.mockRestore();
});

test("row icons resolve Feather-era names through Lucide", async () => {
  useFullIcons();
  const resolver = new IconResolver();
  await resolver.resolveIcons(["check-square"]);
  expect(
    resolver
      .iconNode("check-square")
      ?.classList.contains("lucide-square-check-big"),
  ).toBe(true);
});

test("no icon gives no node", () => {
  expect(new IconResolver().iconNode(undefined)).toBeUndefined();
});
