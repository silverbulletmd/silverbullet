import { expect, test, vi } from "vitest";
import type { StyleRecord } from "../space_style.ts";
import { styleActions, styleStatus } from "./styles.ts";

const style = (source: string, rules: number): StyleRecord => ({
  ref: "Sample@0",
  source,
  rules,
});

test("CSS the browser parsed no rules from is flagged", () => {
  expect(styleStatus(style("body { color: red }", 1))).toBe("applied");
  expect(styleStatus(style("body { color: red", 0))).toBe("empty");
});

test("a block that is only comments or whitespace is not flagged", () => {
  expect(styleStatus(style("/* priority: 10 */\n", 0))).toBe("applied");
  expect(styleStatus(style("  \n", 0))).toBe("applied");
});

test("style rows open their source and copy their CSS", async () => {
  const deps = {
    openSource: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
  };
  for (const a of styleActions(style("p {}", 1))) await a.run(deps);
  expect(deps.openSource).toHaveBeenCalledWith("Sample@0");
  expect(deps.copyText).toHaveBeenCalledWith("p {}");
});
