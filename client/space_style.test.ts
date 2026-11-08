// @vitest-environment happy-dom
import { expect, test } from "vitest";
import type { Client } from "./client.ts";
import { SpaceStyles } from "./space_style.ts";

test("style loading ignores stale records outside protected locations", async () => {
  document.body.innerHTML = '<div id="custom-styles"></div>';
  const styles = new SpaceStyles({
    bootConfig: {},
    objectIndex: { isIndexAvailable: async () => true },
    queryLuaObjects: async () => [
      { tag: "space-style", ref: "Notebook@0", style: "body {display:none}" },
      {
        tag: "data",
        ref: "Library/Forged",
        tags: ["space-style"],
        style: "body {display:none}",
      },
      { tag: "space-style", ref: "CONFIG@0", style: "body {color:blue}" },
      {
        tag: "space-style",
        ref: "Library/Cards@0",
        style: "body {color:green}",
      },
    ],
    ui: { viewDispatch: () => {} },
  } as unknown as Client);
  await styles.load();
  expect(styles.lastLoad?.styles.map((s) => s.ref)).toEqual([
    "CONFIG@0",
    "Library/Cards@0",
  ]);
  expect(document.getElementById("custom-styles")!.innerHTML).not.toContain(
    "display:none",
  );
});
