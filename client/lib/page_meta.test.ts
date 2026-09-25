import { describe, expect, test } from "vitest";
import { localDateString } from "@silverbulletmd/silverbullet/lib/dates";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import {
  pageMetaContentChanged,
  parsePageMetaLastModified,
} from "./page_meta.ts";

describe("parsePageMetaLastModified", () => {
  test("round-trips a PageMeta.lastModified string back to the original epoch ms", () => {
    // PageMeta.lastModified is built from a numeric FileMeta.lastModified via
    // localDateString (see space.ts:fileMetaToPageMeta) -- this is the same
    // conversion echo suppression depends on to compare against the numeric
    // hash carried by the file:changed event.
    const epochMs = Date.parse("2026-08-04T10:20:30.456");
    const asStoredString = localDateString(new Date(epochMs));
    expect(parsePageMetaLastModified(asStoredString)).toBe(epochMs);
  });

  test("returns undefined for an empty string (new/unsaved page)", () => {
    expect(parsePageMetaLastModified("")).toBeUndefined();
  });
});

describe("pageMetaContentChanged", () => {
  const base: PageMeta = {
    ref: "Meta",
    tag: "page",
    name: "Meta",
    created: "2026-09-24T10:00:00.000",
    lastModified: "2026-09-24T10:00:00.000",
    perm: "rw",
    size: 75,
    tags: [],
    itags: ["page"],
    testvalue: 25,
  };

  test("ignores fields that change on every save", () => {
    expect(
      pageMetaContentChanged(base, {
        ...base,
        lastModified: "2026-09-24T10:05:00.000",
        size: 80,
        lastOpened: 1234,
      }),
    ).toBe(false);
  });

  test("detects a changed frontmatter attribute", () => {
    expect(pageMetaContentChanged(base, { ...base, testvalue: 42 })).toBe(true);
  });

  test("detects added and removed attributes", () => {
    expect(pageMetaContentChanged(base, { ...base, status: "draft" })).toBe(
      true,
    );
    const { testvalue: _, ...withoutValue } = base;
    expect(pageMetaContentChanged(base, withoutValue as PageMeta)).toBe(true);
  });

  test("detects changed tags", () => {
    expect(
      pageMetaContentChanged(base, {
        ...base,
        tags: ["project"],
        itags: ["page", "project"],
      }),
    ).toBe(true);
  });

  test("treats a missing previous meta as a change", () => {
    expect(pageMetaContentChanged(undefined, base)).toBe(true);
  });
});
