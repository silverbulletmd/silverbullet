import { beforeEach, describe, expect, test, vi } from "vitest";
import { WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import { QueryBuilder } from "../query/query_builder.ts";
import { followOverviewLink, LINKS } from "./overview_links.ts";

const showView = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../../navigator/navigator.ts", () => ({
  showView: (...args: unknown[]) => showView(...args),
}));
const loadAttributes = vi.fn(async (..._args: unknown[]) => ({
  attributes: [],
  sampled: 0,
}));
vi.mock("../query/query_source.ts", () => ({
  loadAttributes: (...args: unknown[]) => loadAttributes(...args),
}));

describe("followOverviewLink", () => {
  beforeEach(() => {
    showView.mockClear();
    loadAttributes.mockClear();
  });
  const client = { ui: { flashNotification: vi.fn() } } as never;

  test("a tab link shows that Workbench tab", async () => {
    await followOverviewLink(client, new QueryBuilder(), {
      kind: "tab",
      tab: "Scripts",
    });
    expect(showView).toHaveBeenCalledWith(WORKBENCH_VIEW, {
      segment: "Scripts",
    });
  });

  test("a view link shows that view", async () => {
    await followOverviewLink(client, new QueryBuilder(), {
      kind: "view",
      view: "std.gitStatus",
    });
    expect(showView).toHaveBeenCalledWith("std.gitStatus");
  });

  test("a query link picks the source, drops any old target and ends on Query", async () => {
    const builder = new QueryBuilder();
    const setTarget = vi.spyOn(builder, "setTarget");
    await followOverviewLink(client, builder, { kind: "query", tag: "page" });
    expect(builder.model?.source).toEqual({
      root: "page",
      tag: null,
      by: "root",
    });
    expect(setTarget).toHaveBeenCalledWith(null);
    expect(showView).toHaveBeenLastCalledWith(WORKBENCH_VIEW, {
      segment: "Query",
    });
  });

  test("a stale insert target is cleared", async () => {
    const builder = new QueryBuilder();
    builder.setTarget({ page: "Old", from: 1, to: 5 });
    await followOverviewLink(client, builder, { kind: "query", tag: "page" });
    expect(builder.target).toBeNull();
  });

  test("replacing a filtered query does so quietly", async () => {
    const builder = new QueryBuilder();
    await followOverviewLink(client, builder, LINKS.tasksOpen);
    const flashNotification = vi.fn();
    await followOverviewLink({ ui: { flashNotification } } as never, builder, {
      kind: "query",
      tag: "page",
    });
    expect(flashNotification).not.toHaveBeenCalled();
    expect(builder.model?.source.root).toBe("page");
  });

  describe("a tag page link", () => {
    const withConfig = (tagPage: string | null) => {
      const navigate = vi.fn(async () => {});
      return {
        navigate,
        client: {
          config: { get: (_k: unknown, d: unknown) => tagPage ?? d },
          navigate,
          focus: vi.fn(),
        } as never,
      };
    };
    test("goes to the configured tagPage", async () => {
      const { client, navigate } = withConfig("Books/Shelf");
      await followOverviewLink(client, new QueryBuilder(), {
        kind: "tagPage",
        tag: "book",
      });
      expect(navigate).toHaveBeenCalledWith({ path: "Books/Shelf.md" });
    });
    test("falls back to tag:<name>", async () => {
      const { client, navigate } = withConfig(null);
      await followOverviewLink(client, new QueryBuilder(), {
        kind: "tagPage",
        tag: "book",
      });
      expect(navigate).toHaveBeenCalledWith({ path: "tag:book.md" });
    });
  });

  test("a user tag becomes a tag source", async () => {
    const builder = new QueryBuilder();
    await followOverviewLink(client, builder, { kind: "query", tag: "book" });
    expect(builder.model?.source).toEqual({
      root: null,
      tag: "book",
      by: "tag",
    });
  });

  test("open and done tasks filter on done", async () => {
    const builder = new QueryBuilder();
    await followOverviewLink(client, builder, LINKS.tasksOpen);
    expect(builder.model?.filters).toEqual([
      { kind: "attribute", attribute: "done", op: "false", values: [] },
    ]);
    await followOverviewLink(client, builder, LINKS.tasksDone);
    expect(builder.model?.filters).toEqual([
      { kind: "attribute", attribute: "done", op: "true", values: [] },
    ]);
  });

  test("open and done tasks render with the taskItem template", async () => {
    const builder = new QueryBuilder();
    await followOverviewLink(client, builder, LINKS.tasksOpen);
    expect(builder.model?.select).toEqual({
      mode: "list",
      list: { template: "templates.taskItem" },
    });
  });

  test("all tags opens the distinct tag-name query, browsing", async () => {
    const builder = new QueryBuilder();
    builder.setTarget({ page: "Old", from: 0, to: 0 });
    await followOverviewLink(client, builder, LINKS.allTags);
    expect(builder.target).toBeNull();
    expect(builder.model?.source).toEqual({
      root: "tag",
      tag: null,
      by: "root",
    });
    expect(builder.model?.select).toEqual({
      mode: "table",
      columns: [{ id: "c1", header: "name", kind: "attribute", value: "name" }],
    });
    expect(showView).toHaveBeenLastCalledWith(WORKBENCH_VIEW, {
      segment: "Query",
    });
  });
});
