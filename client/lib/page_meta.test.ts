import { describe, expect, test } from "vitest";
import { localDateString } from "@silverbulletmd/silverbullet/lib/dates";
import { parsePageMetaLastModified } from "./page_meta.ts";

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
