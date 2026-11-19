import { expect, test, vi } from "vitest";
import { iconSvg } from "./registry.ts";

// Dashboards never configure a source: only the bundled core set exists
test("without a configured source, unknown names render the fallback, not a placeholder", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(iconSvg("bogus-name")).toContain("lucide-circle-question-mark");
  expect(iconSvg("tag")).toContain("lucide-tag");
});
