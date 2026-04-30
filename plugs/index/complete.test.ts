import { describe, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { indexMarkdown } from "./indexer.ts";
import { anchorComplete } from "./complete.ts";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";

const pageMeta = (name: string): PageMeta => ({
  ref: name,
  tag: "page",
  name,
  perm: "rw",
  lastModified: "",
  created: "",
});

/**
 * Indexes markdown for a page and stores all resulting objects into the
 * mock index so that queryLuaObjects can find them.
 */
async function indexPage(text: string, name: string): Promise<void> {
  const objects = await indexMarkdown(text, pageMeta(name));
  await (globalThis as any).syscall("index.indexObjects", name, objects);
}

function makeCompleteEvent(
  linePrefix: string,
  currentPage = "TestPage",
): CompleteEvent {
  return {
    linePrefix,
    pos: linePrefix.length,
    pageName: currentPage,
    parentNodes: [],
  };
}

describe("anchorComplete", () => {
  test("bare [[$p completes anchors matching prefix p", async () => {
    createMockSystem();
    await indexPage(`Hello $pete world.\n`, "PageA");
    await indexPage(`Another $people here.\n`, "PageB");
    await indexPage(`Unrelated $qux.\n`, "PageC");

    const result = await anchorComplete(
      makeCompleteEvent("Go to [["),
    );
    // No $ typed yet — should not trigger
    expect(result).toBeNull();
  });

  test("bare [[$ with no prefix shows all anchors", async () => {
    createMockSystem();
    await indexPage(`Para $alpha here.\n`, "PageA");
    await indexPage(`Para $beta here.\n`, "PageB");

    const result = await anchorComplete(
      makeCompleteEvent("[[$"),
    );
    expect(result).toBeTruthy();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("$alpha");
    expect(labels).toContain("$beta");
  });

  test("[[$p filters anchors by prefix", async () => {
    createMockSystem();
    await indexPage(`Para $pete here.\n`, "PageA");
    await indexPage(`Para $people here.\n`, "PageB");
    await indexPage(`Para $qux here.\n`, "PageC");

    const result = await anchorComplete(
      makeCompleteEvent("[[$p"),
    );
    expect(result).toBeTruthy();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("$pete");
    expect(labels).toContain("$people");
    expect(labels).not.toContain("$qux");
  });

  test("from position is set to right after the [[ (before the $)", async () => {
    createMockSystem();
    await indexPage(`Para $anchor.\n`, "PageA");

    const linePrefix = "[[$anc";
    const result = await anchorComplete(makeCompleteEvent(linePrefix));
    expect(result).toBeTruthy();
    // pos=6, prefix="anc" (length 3), page="" (length 0)
    // from = pos - prefix.length - 1($) - page.length = 6 - 3 - 1 - 0 = 2
    // Position 2 is '$', so label "$anchor" replaces "$anc" → correct.
    expect(result!.from).toBe(2);
  });

  test("page-qualified [[PageA$p filters to anchors on PageA", async () => {
    createMockSystem();
    await indexPage(`Para $pete here.\n`, "PageA");
    await indexPage(`Para $pete here.\n`, "PageB"); // same anchor on different page

    const result = await anchorComplete(
      makeCompleteEvent("[[PageA$p"),
    );
    expect(result).toBeTruthy();
    const options = result!.options;
    // All returned options should have detail mentioning PageA only
    for (const opt of options) {
      expect(opt.detail).toContain("PageA");
      expect(opt.detail).not.toContain("PageB");
    }
  });

  test("page-qualified label includes page prefix", async () => {
    createMockSystem();
    await indexPage(`Para $sec1 here.\n`, "SomePage");

    const result = await anchorComplete(
      makeCompleteEvent("[[SomePage$"),
    );
    expect(result).toBeTruthy();
    const labels = result!.options.map((o) => o.label);
    // label should be "SomePage$sec1" (page prefix + $ + anchor name)
    expect(labels).toContain("SomePage$sec1");
  });

  test("does not trigger when no $ is present in wikilink", async () => {
    createMockSystem();
    await indexPage(`Para $alpha.\n`, "PageA");

    const result = await anchorComplete(
      makeCompleteEvent("[[SomePage"),
    );
    expect(result).toBeNull();
  });

  test("options are sorted alphabetically by ref", async () => {
    createMockSystem();
    await indexPage(`$zebra para.\n`, "P1");
    await indexPage(`$apple para.\n`, "P2");
    await indexPage(`$mango para.\n`, "P3");

    const result = await anchorComplete(makeCompleteEvent("[[$"));
    expect(result).toBeTruthy();
    const labels = result!.options.map((o) => o.label);
    const sorted = [...labels].sort();
    expect(labels).toEqual(sorted);
  });

  test("detail field contains hostTag and page", async () => {
    createMockSystem();
    await indexPage(`Para $info here.\n`, "DocPage");

    const result = await anchorComplete(makeCompleteEvent("[[$info"));
    expect(result).toBeTruthy();
    const opt = result!.options.find((o) => o.label.includes("info"));
    expect(opt).toBeTruthy();
    expect(opt!.detail).toContain("paragraph");
    expect(opt!.detail).toContain("DocPage");
  });
});
