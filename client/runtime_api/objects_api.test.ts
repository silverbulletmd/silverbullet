import { expect, test, vi } from "vitest";
import { handleObjectsRequest } from "./objects_api.ts";

function fakeDeps(
  overrides: Partial<{
    queryLuaObjects: (env: any, tag: string, query: any) => Promise<any[]>;
    tagNames: () => Promise<string[]>;
  }> = {},
) {
  return {
    objectIndex: {
      queryLuaObjects: overrides.queryLuaObjects ?? (async () => []),
      tagNames: overrides.tagNames ?? (async () => []),
    } as any,
    env: {} as any,
    stackFrame: {} as any,
  };
}

test("list_tags returns the tagNames output verbatim", async () => {
  const deps = fakeDeps({
    tagNames: async () => ["page", "task"],
  });
  const res = await handleObjectsRequest(deps, { kind: "list_tags" });
  expect(res).toEqual({ ok: true, items: ["page", "task"] });
});

test("get returns the object when found", async () => {
  const deps = fakeDeps({
    queryLuaObjects: async (_env, tag, _query) => [
      { tag, ref: "x", name: "x" },
    ],
  });
  const res = await handleObjectsRequest(deps, {
    kind: "get",
    tag: "page",
    ref: "x",
  });
  expect(res).toEqual({ ok: true, item: { tag: "page", ref: "x", name: "x" } });
});

test("get returns not_found when missing", async () => {
  const deps = fakeDeps({ queryLuaObjects: async () => [] });
  const res = await handleObjectsRequest(deps, {
    kind: "get",
    tag: "page",
    ref: "nope",
  });
  expect(res).toEqual({
    ok: false,
    code: "not_found",
    error: expect.any(String),
  });
});

test("list calls queryLuaObjects with translated query and returns items+total", async () => {
  const spy = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
  const deps = fakeDeps({ queryLuaObjects: spy });
  const res = await handleObjectsRequest(deps, {
    kind: "list",
    tag: "task",
    filters: [{ field: "done", op: "eq", value: "false" }],
    order: [],
    limit: 100,
    offset: 0,
  });
  expect(res).toEqual({
    ok: true,
    items: [{ id: 1 }, { id: 2 }],
    equivalentLua: expect.stringContaining("_it.done == false"),
  });
  expect(spy).toHaveBeenCalledOnce();
  const [, tag, query] = spy.mock.calls[0];
  expect(tag).toBe("task");
  expect(query.limit).toBe(100);
});

test("list rejects bad query with bad_query / bad_field", async () => {
  const deps = fakeDeps();
  const res = await handleObjectsRequest(deps, {
    kind: "list",
    tag: "task",
    filters: [{ field: "1bad", op: "eq", value: "v" }],
    order: [],
    limit: 10,
    offset: 0,
  });
  expect(res).toEqual({
    ok: false,
    code: "bad_field",
    error: expect.any(String),
  });
});
