import { describe, expect, test, vi } from "vitest";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "../../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../../space_lua/stdlib.ts";
import { sourceFor } from "./query_from.ts";
import {
  aggregateChoices,
  evalQueryText,
  filterTags,
  listTags,
  loadAttributes,
  NO_TAGS,
  SAMPLE_LIMIT,
  splitTags,
  tagsUsedOn,
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
    const tags = splitTags([
      { name: "book", parent: "page" },
      { name: "anchor" },
      { name: "task" },
      { name: "person", parent: "item" },
      { name: "book", parent: "item" },
      { name: "relation" },
      { name: "page" },
    ]);
    expect(tags.user).toEqual(["book", "person"]);
    expect(tags.builtIn).toEqual(["page", "task", "relation", "anchor"]);
  });

  test("each user tag knows the root tags it's used on", () => {
    const tags = splitTags([
      { name: "work", parent: "task" },
      { name: "work", parent: "page" },
      { name: "home", parent: "item" },
    ]);
    expect(tags.usedOn).toEqual({ work: ["page", "task"], home: ["item"] });
    expect(tagsUsedOn(tags, "task")).toEqual(["work"]);
  });

  test("root tags data blocks define are listed apart", () => {
    const tags = splitTags([
      { name: "contact", parent: "data" },
      { name: "contact", parent: "item" },
      { name: "expense", parent: "data" },
    ]);
    expect(tags.dataRoots).toEqual(["contact", "expense"]);
    // Also used as a hashtag, it's a user tag too
    expect(tags.user).toEqual(["contact"]);
    expect(tagsUsedOn(tags, "data")).toEqual(["contact", "expense"]);
  });

  test("the deprecated link view is neither built-in nor a user tag", () => {
    const tags = splitTags([{ name: "link" }, { name: "book" }]);
    expect(tags.user).toEqual(["book"]);
    expect(tags.builtIn).toEqual([]);
  });
});

describe("filterTags", () => {
  const tags = {
    ...NO_TAGS,
    user: ["book", "meta/api", "person", "project"],
    builtIn: ["page", "task"],
    dataRoots: ["contact"],
  };
  const lists = (t: typeof tags) => ({
    user: t.user,
    builtIn: t.builtIn,
    dataRoots: t.dataRoots,
  });

  test("an empty phrase keeps everything", () => {
    expect(filterTags(tags, "  ")).toEqual(tags);
  });

  test("matches any part of the name, ignoring case", () => {
    expect(lists(filterTags(tags, "PRO"))).toEqual({
      user: ["project"],
      builtIn: [],
      dataRoots: [],
    });
    expect(lists(filterTags(tags, "a"))).toEqual({
      user: ["meta/api"],
      builtIn: ["page", "task"],
      dataRoots: ["contact"],
    });
  });

  test("a leading # is ignored", () => {
    expect(filterTags(tags, "#bo").user).toEqual(["book"]);
  });

  test("names starting with the phrase come first", () => {
    expect(
      filterTags({ ...NO_TAGS, user: ["mybook", "book"] }, "book").user,
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

describe("loadAttributes", () => {
  test("an empty tag gives no attributes", async () => {
    const { client } = stubClient({});
    expect(await loadAttributes(client, sourceFor("book"))).toEqual({
      attributes: [],
      sampled: 0,
    });
  });

  test("samples at most 500 objects", async () => {
    const { client, queryLuaObjects } = stubClient({
      objects: [{ title: "Piranesi" }],
    });
    const { attributes, sampled } = await loadAttributes(
      client,
      sourceFor("book"),
    );
    expect(SAMPLE_LIMIT).toBe(500);
    expect(queryLuaObjects).toHaveBeenCalledWith(
      "book",
      expect.objectContaining({ limit: 500 }),
    );
    expect(sampled).toBe(1);
    expect(attributes.map((f) => f.name)).toEqual(["title"]);
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
    const { attributes } = await loadAttributes(client, sourceFor("project"));
    const status = attributes.find((f) => f.name === "status")!;
    expect(status.source).toBe("declared");
    expect(attributes.find((f) => f.name === "budget")!.source).toBe(
      "inferred",
    );
  });

  test("built-in tags mark declared attributes built-in", async () => {
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
    const { attributes } = await loadAttributes(client, sourceFor("task"));
    expect(attributes[0].source).toBe("built-in");
  });
});

describe("attributes of a tag on pages", () => {
  test("the tag's own attributes come first; the page's own attributes are built-in", async () => {
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
    const { attributes } = await loadAttributes(client, sourceFor("book"));
    const own = attributes
      .filter((f) => !f.system)
      .map((f) => [f.name, f.source]);
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

test("system tags aren't offered", () => {
  const tags = splitTags([{ name: "space-lua" }, { name: "page" }]);
  expect(tags.builtIn).toEqual(["page"]);
  expect(tags.user).toEqual([]);
});
