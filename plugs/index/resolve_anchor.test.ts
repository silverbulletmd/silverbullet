import { describe, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { indexMarkdown } from "./indexer.ts";
import { resolveAnchor } from "./api.ts";

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
 * mock index so that queryLuaObjects / getObjectByRef can find them.
 */
async function indexPage(text: string, name: string): Promise<void> {
  const objects = await indexMarkdown(text, pageMeta(name));
  // syscall is set up by createMockSystem on globalThis
  await (globalThis as any).syscall("index.indexObjects", name, objects);
}

describe("resolveAnchor", () => {
  test("resolves a paragraph anchor on a single page", async () => {
    createMockSystem();
    await indexPage(`Hello $greeting world.\n`, "PageA");

    const result = await resolveAnchor("greeting");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page).toBe("PageA");
      expect(result.hostTag).toBe("paragraph");
      expect(Array.isArray(result.range)).toBe(true);
      expect(result.range).toHaveLength(2);
    }
  });

  test("returns missing when anchor does not exist", async () => {
    createMockSystem();
    await indexPage(`Normal paragraph.\n`, "PageB");

    const result = await resolveAnchor("nonexistent");
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  test("returns duplicate when same anchor name exists on multiple pages", async () => {
    createMockSystem();
    await indexPage(`First $shared anchor.\n`, "Page1");
    await indexPage(`Second $shared anchor.\n`, "Page2");

    const result = await resolveAnchor("shared");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("duplicate");
      if (result.reason === "duplicate") {
        const pages = result.hits.map((h) => h.page).sort();
        expect(pages).toEqual(["Page1", "Page2"]);
      }
    }
  });

  test("page-scoped lookup resolves when anchor exists on the specified page", async () => {
    createMockSystem();
    await indexPage(`First $shared anchor.\n`, "Page1");
    await indexPage(`Second $shared anchor.\n`, "Page2");

    const result = await resolveAnchor("shared", "Page1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page).toBe("Page1");
    }
  });

  test("page-scoped lookup returns missing when anchor is on a different page", async () => {
    createMockSystem();
    await indexPage(`Anchor $mine here.\n`, "PageX");

    const result = await resolveAnchor("mine", "PageY");
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  test("resolves a page-level anchor (frontmatter $ref) to position 0", async () => {
    createMockSystem();
    // Write the anchor record directly. indexMarkdown skips the page
    // indexer, so we mimic what page.ts emits for `$ref: today` in
    // frontmatter.
    await (globalThis as any).syscall(
      "index.indexObjects",
      "Inbox/2026-04-30",
      [
        {
          tag: "anchor",
          ref: "today",
          page: "Inbox/2026-04-30",
          hostTag: "page",
        },
      ],
    );

    const result = await resolveAnchor("today");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page).toBe("Inbox/2026-04-30");
      expect(result.hostTag).toBe("page");
      expect(result.range).toEqual([0, 0]);
    }
  });

  test("resolves a header anchor", async () => {
    createMockSystem();
    await indexPage(`# Introduction $intro\n\nSome content.\n`, "DocPage");

    const result = await resolveAnchor("intro");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page).toBe("DocPage");
      expect(result.hostTag).toBe("header");
    }
  });
});
