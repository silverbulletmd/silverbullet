import { installRestrictedContext } from "../../space_lua/restricted_context.ts";
import { System } from "../../plugos/system.ts";
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
  loadAttributes,
  SAMPLE_LIMIT,
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

describe("loadAttributes", () => {
  test("an empty tag gives no attributes", async () => {
    const { client } = stubClient({});
    expect(await loadAttributes(client, sourceFor("book"))).toEqual({
      attributes: [],
      sampled: 0,
      samples: [],
      root: null,
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

test("Editor query evaluation uses restricted APIs even with a privileged global environment", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  installRestrictedContext(env, new System());
  const { client } = stubClient({ env });
  client.bootConfig = { canBuild: false };
  expect(await evalQueryText(client, "math.floor(9 / 2)")).toBe(4);
  await expect(evalQueryText(client, "js.window")).rejects.toThrow();
});
