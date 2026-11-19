// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { moreIcon, widgetActionIcon } from "./widget_menu.ts";

test("widget action icons are Lucide icons from the shared registry", () => {
  expect(widgetActionIcon("remove")).toContain("lucide-trash");
  expect(widgetActionIcon("edit")).toContain("lucide-square-pen");
  expect(moreIcon).toContain("lucide-ellipsis-vertical");
});
