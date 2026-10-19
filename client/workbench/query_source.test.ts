import { describe, expect, test, vi } from "vitest";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import {
  aggregateChoices,
  evalQueryText,
  filterTags,
  listTags,
  loadFields,
  SAMPLE_LIMIT,
  splitTags,
} from "./query_source.ts";

function stubClient(opts: {
  objects?: Record<string, unknown>[];
  config?: Record<string, unknown>;
  env?: LuaEnv;
}) {
  const queryLuaObjects = vi.fn(async () => opts.objects ?? []);
  const client = {
    queryLuaObjects,
    config: {
      get: (key: string | string[], fallback: unknown) => {
        const k = Array.isArray(key) ? key.join(".") : key;
        return opts.config?.[k] ?? fallback;
      },
    },
    clientSystem: { spaceLuaEnv: { env: opts.env ?? new LuaEnv() } },
  };
  return { client: client as any, queryLuaObjects };
}

describe("splitTags", () => {
  test("user tags apart from built-in tags, built-in ones in kind order", () => {
    expect(
      splitTags([
        "book",
        "anchor",
        "task",
        "person",
        "book",
        "relation",
        "page",
      ]),
    ).toEqual({
      user: ["book", "person"],
      builtIn: ["page", "task", "relation", "anchor"],
    });
  });

  test("the deprecated link view is neither built-in nor a user tag", () => {
    expect(splitTags(["link", "book"])).toEqual({
      user: ["book"],
      builtIn: [],
    });
  });
});

describe("filterTags", () => {
  const tags = {
    user: ["book", "meta/api", "person", "project"],
    builtIn: ["page", "task"],
  };

  test("an empty phrase keeps everything", () => {
    expect(filterTags(tags, "  ")).toEqual(tags);
  });

  test("matches any part of the name, ignoring case", () => {
    expect(filterTags(tags, "PRO")).toEqual({
      user: ["project"],
      builtIn: [],
    });
    expect(filterTags(tags, "a")).toEqual({
      user: ["meta/api"],
      builtIn: ["page", "task"],
    });
  });

  test("a leading # is ignored", () => {
    expect(filterTags(tags, "#bo")).toEqual({ user: ["book"], builtIn: [] });
  });

  test("names starting with the phrase come first", () => {
    expect(
      filterTags({ user: ["mybook", "book"], builtIn: [] }, "book").user,
    ).toEqual(["book", "mybook"]);
  });
});

describe("listTags", () => {
  test("tags used only in the standard library aren't listed", async () => {
    const { client } = stubClient({
      objects: [
        { name: "book", page: "Books/Piranesi" },
        { name: "meta", page: "Library/Std/Config" },
        { name: "meta", page: "Notes/Meta" },
        { name: "meta/api", page: "Library/Std/APIs/Tag" },
      ],
    });
    const { user } = await listTags(client);
    expect(user).toEqual(["book", "meta"]);
  });
});

describe("loadFields", () => {
  test("an empty tag gives no fields", async () => {
    const { client } = stubClient({});
    expect(await loadFields(client, "book")).toEqual({
      fields: [],
      sampled: 0,
    });
  });

  test("samples at most 500 objects", async () => {
    const { client, queryLuaObjects } = stubClient({
      objects: [{ title: "Piranesi" }],
    });
    const { fields, sampled } = await loadFields(client, "book");
    expect(SAMPLE_LIMIT).toBe(500);
    expect(queryLuaObjects).toHaveBeenCalledWith(
      "book",
      expect.objectContaining({ limit: 500 }),
    );
    expect(sampled).toBe(1);
    expect(fields.map((f) => f.name)).toEqual(["title"]);
  });

  test("merges the declared schema from the tags config", async () => {
    const { client } = stubClient({
      objects: [{ name: "Garden shed", budget: 1200 }],
      config: {
        tags: {
          project: {
            schema: {
              type: "object",
              properties: { status: { type: "string", enum: ["active"] } },
            },
          },
        },
      },
    });
    const { fields } = await loadFields(client, "project");
    const status = fields.find((f) => f.name === "status")!;
    expect(status.source).toBe("declared");
    expect(fields.find((f) => f.name === "budget")!.source).toBe("inferred");
  });

  test("built-in tags mark declared fields built-in", async () => {
    const { client } = stubClient({
      objects: [{ name: "x" }],
      config: {
        tags: {
          task: {
            schema: {
              type: "object",
              properties: { name: { type: "string" } },
            },
          },
        },
      },
    });
    const { fields } = await loadFields(client, "task");
    expect(fields[0].source).toBe("built-in");
  });
});

describe("fields of a tag on pages", () => {
  test("the tag's own fields come first; the page's own fields are built-in", async () => {
    const { client } = stubClient({
      objects: [
        {
          ref: "Books/Piranesi",
          tag: "page",
          name: "Books/Piranesi",
          size: 140,
          lastModified: "2026-10-17T10:00:00",
          author: "Susanna Clarke",
          status: "finished",
        },
      ],
      config: {
        tags: {
          page: {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                size: { type: "number" },
                lastModified: { type: "string" },
                aliases: { type: "array" },
              },
            },
          },
        },
      },
    });
    const { fields } = await loadFields(client, "book");
    const own = fields.filter((f) => !f.system).map((f) => [f.name, f.source]);
    expect(own).toEqual([
      ["name", "built-in"],
      ["author", "inferred"],
      ["status", "inferred"],
      ["size", "built-in"],
      ["lastModified", "built-in"],
    ]);
  });
});

describe("aggregateChoices", () => {
  test("built-in and configured aggregates", () => {
    const { client } = stubClient({
      config: { aggregates: { median: { description: "Middle value" } } },
    });
    const names = aggregateChoices(client).map((a) => a.name);
    expect(names).toContain("count");
    expect(names).toContain("avg");
    expect(names).toContain("median");
  });
});

describe("evalQueryText", () => {
  test("evaluates a query in the space environment", async () => {
    const env = new LuaEnv(luaBuildStandardEnv());
    const index = new LuaTable();
    await index.set("tag", () =>
      jsToLuaValue([{ name: "Piranesi" }, { name: "Klara and the Sun" }]),
    );
    env.set("index", index);
    const { client } = stubClient({ env });
    const result = await evalQueryText(
      client,
      'query[[\n  from b = index.tag "book"\n  order by b.name\n  select b.name\n]]',
    );
    expect(luaValueToJS(result, LuaStackFrame.lostFrame)).toEqual([
      "Klara and the Sun",
      "Piranesi",
    ]);
  });

  test("throws parse errors to the caller", async () => {
    const { client } = stubClient({});
    await expect(
      evalQueryText(
        client,
        'query[[ from b = index.tag "book" where b.x == ]]',
      ),
    ).rejects.toThrow();
  });
});
