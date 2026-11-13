import { describe, expect, it } from "vitest";
import {
  collapseEdges,
  deriveTagFields,
  endpointMatchesRef,
  isHiddenTag,
  type RelationRow,
  splitToolPages,
} from "./graph_builder.ts";

describe("endpointMatchesRef", () => {
  it("matches exact refs", () => {
    expect(endpointMatchesRef("Page", "Page")).toBe(true);
  });

  it("matches positional / header / anchor variants", () => {
    expect(endpointMatchesRef("Page@123", "Page")).toBe(true);
    expect(endpointMatchesRef("Page#h1", "Page")).toBe(true);
    expect(endpointMatchesRef("Page$anchor", "Page")).toBe(true);
  });

  it("rejects prefix overlap that isn't a real boundary", () => {
    expect(endpointMatchesRef("Pages", "Page")).toBe(false);
    expect(endpointMatchesRef("Page/sub", "Page")).toBe(false);
    expect(endpointMatchesRef("Page-x", "Page")).toBe(false);
  });

  it("rejects unrelated endpoints", () => {
    expect(endpointMatchesRef("Other", "Page")).toBe(false);
  });
});

describe("isHiddenTag", () => {
  it("hides built-in tags and the graph's own block kind", () => {
    expect(isHiddenTag("page")).toBe(true);
    expect(isHiddenTag("item")).toBe(true);
    expect(isHiddenTag("task")).toBe(true);
    expect(isHiddenTag("aspiring-page")).toBe(true);
    expect(isHiddenTag("block")).toBe(true);
  });
});

describe("splitToolPages", () => {
  it("separates Tool Pages by location, not by tag", () => {
    const { pages, toolPageNames } = splitToolPages([
      { name: "Library/Config" },
      { name: "Library/Std/Config" },
      { name: "Notes", tags: ["meta/template"] },
      { name: "Libraryish" },
    ]);
    expect(pages.map((p) => p.name)).toEqual(["Notes", "Libraryish"]);
    expect([...toolPageNames]).toEqual([
      "Library/Config",
      "Library/Std/Config",
    ]);
  });
});

describe("deriveTagFields", () => {
  it("uses hostTag as rootTag for built-in root tags", () => {
    const r = deriveTagFields(["page", "driver"], "page");
    expect(r.rootTag).toBe("page");
    expect(r.colorTag).toBe("driver");
    expect(r.tags).toEqual(["driver"]);
  });

  it("promotes item to task when the task tag is present", () => {
    const r = deriveTagFields(["item", "task", "todo"], "item");
    expect(r.rootTag).toBe("task");
    expect(r.colorTag).toBe("todo");
  });

  it("filters built-in and meta tags out of the user-tag list", () => {
    const r = deriveTagFields(
      ["page", "meta", "meta/template", "research"],
      "page",
    );
    expect(r.tags).toEqual(["research"]);
    expect(r.colorTag).toBe("research");
  });

  it("returns null rootTag for host tags that aren't root tags", () => {
    expect(deriveTagFields(["foo"], "foo").rootTag).toBeNull();
  });
});

describe("collapseEdges", () => {
  const baseRow = (overrides: Partial<RelationRow>): RelationRow => ({
    from: "A",
    to: "B",
    kind: "mention",
    page: "A",
    ...overrides,
  });

  it("collapses reciprocal co-mention pairs into one undirected edge", () => {
    const rows: RelationRow[] = [
      baseRow({ kind: "co-mention", via: "page1" }),
      baseRow({
        from: "B",
        to: "A",
        kind: "co-mention",
        via: "page1",
        page: "page1",
      }),
    ];
    const out = collapseEdges(rows);
    expect(out).toHaveLength(1);
    expect(out[0].undirected).toBe(true);
    expect(out[0].refs).toHaveLength(2);
  });

  it("keeps distinct co-mention pairs separate when 'via' differs", () => {
    const rows: RelationRow[] = [
      baseRow({ kind: "co-mention", via: "p1" }),
      baseRow({
        from: "B",
        to: "A",
        kind: "co-mention",
        via: "p2",
      }),
    ];
    expect(collapseEdges(rows)).toHaveLength(2);
  });

  it("preserves provenance positions from the range tuple", () => {
    const out = collapseEdges([baseRow({ range: [42, 60], snippet: "hello" })]);
    expect(out[0].refs[0]).toEqual({ page: "A", pos: 42, snippet: "hello" });
  });
});
