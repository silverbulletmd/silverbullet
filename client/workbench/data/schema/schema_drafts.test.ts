import { describe, expect, test, vi } from "vitest";
import { CONFIG_UNSET } from "../../../config.ts";
import { SCHEMAS_MARKER } from "../../../config_management/config_block.ts";
import { ConfigReloadError } from "../../../config_management/config_page.ts";
import {
  applySchemaChanges,
  type SchemaChanges,
} from "../../../config_management/schema_block.ts";
import type { JsonSchema } from "../../../config_management/schema_lua.ts";
import { type SchemaDraftDeps, SchemaDrafts } from "./schema_drafts.ts";

const PAGE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    due: { type: "string", description: "When" },
  },
  required: ["name"],
};

type World = {
  configText: string;
  definitions: Record<string, any>;
  scripts: { ref: string; page: string; script: string }[];
  writable: boolean;
};

function setup(
  over: Partial<World> = {},
  depsOver: Partial<SchemaDraftDeps> = {},
) {
  const world: World = {
    configText: "# Config\n",
    definitions: { page: { schema: PAGE_SCHEMA } },
    scripts: [
      {
        ref: "Library/Std/Infrastructure/Root Tags@1",
        page: "Library/Std/Infrastructure/Root Tags",
        script: 'tag.define { name = "page", schema = { type = "object" } }',
      },
    ],
    writable: true,
    ...over,
  };
  let reload = () => {};
  const saved: SchemaChanges[] = [];
  const onDirty = vi.fn();
  const deps: SchemaDraftDeps = {
    load: async () => ({
      ...world,
      definitions: JSON.parse(JSON.stringify(world.definitions)),
    }),
    save: async (changes) => {
      saved.push(changes);
      world.configText = applySchemaChanges(world.configText, changes);
    },
    effective: (tag) => world.definitions[tag]?.schema ?? null,
    subscribeReload: (changed) => {
      reload = changed;
      return () => {};
    },
    onDirty,
    ...depsOver,
  };
  const drafts = new SchemaDrafts(deps);
  return { drafts, world, saved, onDirty, reload: () => reload() };
}

async function ready(drafts: SchemaDrafts) {
  drafts.subscribe(() => {});
  await new Promise((r) => setTimeout(r, 0));
}

describe("ownership", () => {
  test("a tag with a schema from a script is external; one with none is none", async () => {
    const { drafts } = setup();
    await ready(drafts);
    expect(drafts.ownership("page")).toBe("external");
    expect(drafts.ownership("meeting")).toBe("none");
  });

  test("a tag defined by the schemas block is owned", async () => {
    const configText = applySchemaChanges("# Config\n", {
      define: { meeting: { type: "object" } },
      set: [],
      reset: [],
      require: [],
    });
    const { drafts } = setup({ configText });
    await ready(drafts);
    expect(drafts.ownership("meeting")).toBe("owned");
    expect(drafts.conflict("meeting")).toEqual([]);
  });

  test("another script also giving an owned tag a schema is a conflict", async () => {
    const configText = applySchemaChanges("# Config\n", {
      define: { book: { type: "object" } },
      set: [],
      reset: [],
      require: [],
    });
    const { drafts } = setup({
      configText,
      scripts: [
        {
          ref: "Books@3",
          page: "Books",
          script: 'tag.define { name = "book", schema = { type = "object" } }',
        },
      ],
    });
    await ready(drafts);
    expect(drafts.conflict("book")).toEqual([
      { ref: "Books@3", page: "Books" },
    ]);
  });
});

describe("changes", () => {
  test("first save of a tag without a schema writes one define with the kept attributes", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    drafts.setRule("meeting", "date", { type: "string", format: "date" });
    expect(drafts.changesFor("meeting").define).toEqual({
      meeting: {
        type: "object",
        properties: {
          room: { type: "string" },
          date: { type: "string", format: "date" },
        },
      },
    });
  });

  test("declaring a schema drafts its properties and requirements at once", async () => {
    const { drafts, onDirty } = setup();
    await ready(drafts);
    drafts.declare("meeting", {
      type: "object",
      properties: { room: { type: "string" } },
      required: ["room"],
    });
    expect(drafts.changesFor("meeting").define).toEqual({
      meeting: {
        type: "object",
        properties: { room: { type: "string" } },
        required: ["room"],
      },
    });
    expect(onDirty.mock.calls).toEqual([[true]]);
  });

  test("declaring an empty schema starts no draft", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.declare("meeting", { type: "object", properties: {} });
    expect(drafts.draft("meeting")).toBeUndefined();
  });

  test("an owned schema's later save updates its define, adding nothing it wasn't told", async () => {
    const configText = applySchemaChanges("# Config\n", {
      define: {
        meeting: { type: "object", properties: { room: { type: "string" } } },
      },
      set: [],
      reset: [],
      require: [],
    });
    const { drafts } = setup({ configText });
    await ready(drafts);
    drafts.setRequired("meeting", "room", true);
    expect(drafts.changesFor("meeting")).toMatchObject({
      define: {
        meeting: {
          type: "object",
          properties: { room: { type: "string" } },
          required: ["room"],
        },
      },
      set: [],
    });
  });

  test("an external schema saves only targeted sets for the changed properties", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.setRule("page", "category", { type: "string" });
    const changes = drafts.changesFor("page");
    expect(changes.define).toEqual({});
    expect(changes.set).toEqual([
      {
        path: ["tags", "page", "schema", "properties", "category"],
        value: { type: "string" },
      },
    ]);
  });

  test("changing only a description writes a set on the description path", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.setRule("page", "due", { type: "string", description: "Due date" });
    expect(drafts.changesFor("page").set).toEqual([
      {
        path: ["tags", "page", "schema", "properties", "due", "description"],
        value: "Due date",
      },
    ]);
  });

  test("making an external attribute required or optional writes a require statement", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.setRequired("page", "due", true);
    drafts.setRequired("page", "name", false);
    expect(drafts.changesFor("page").require).toEqual([
      { tag: "page", attribute: "due", required: true },
      { tag: "page", attribute: "name", required: false },
    ]);
  });

  test("rename moves the rule and its requirement, removing the old rule", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.rename("page", "name", "title");
    const changes = drafts.changesFor("page");
    expect(changes.set).toEqual(
      expect.arrayContaining([
        {
          path: ["tags", "page", "schema", "properties", "title"],
          value: { type: "string" },
        },
        {
          path: ["tags", "page", "schema", "properties", "name"],
          value: CONFIG_UNSET,
        },
      ]),
    );
    expect(changes.require).toEqual(
      expect.arrayContaining([
        { tag: "page", attribute: "title", required: true },
        { tag: "page", attribute: "name", required: false },
      ]),
    );
  });

  test("renaming in an owned schema moves the property and its requirement", async () => {
    const configText = applySchemaChanges("# Config\n", {
      define: {
        meeting: {
          type: "object",
          properties: { room: { type: "string" } },
          required: ["room"],
        },
      },
      set: [],
      reset: [],
      require: [],
    });
    const { drafts } = setup({ configText });
    await ready(drafts);
    drafts.rename("meeting", "room", "place");
    expect(drafts.changesFor("meeting").define.meeting).toEqual({
      type: "object",
      properties: { place: { type: "string" } },
      required: ["place"],
    });
  });

  test("removing an inherited rule suppresses it with CONFIG_UNSET", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.removeRule("page", "due");
    expect(drafts.changesFor("page").set).toEqual([
      {
        path: ["tags", "page", "schema", "properties", "due"],
        value: CONFIG_UNSET,
      },
    ]);
  });

  test("reset drops the targeted writes for that attribute", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.reset("page", "category");
    const changes = drafts.changesFor("page");
    expect(changes.reset).toEqual([
      ["tags", "page", "schema", "properties", "category"],
      ["tags", "page", "schema", "properties", "category", "description"],
    ]);
    expect(changes.resetRequire).toEqual([
      { tag: "page", attribute: "category" },
    ]);
  });

  test("an icon on a user tag saves pageDecoration.icon; on a built-in it saves icon", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.setIcon("meeting", "calendar");
    drafts.setIcon("page", "file");
    expect(drafts.changesFor("meeting").set).toEqual([
      {
        path: ["tags", "meeting", "pageDecoration", "icon"],
        value: "calendar",
      },
    ]);
    expect(drafts.changesFor("page").set).toEqual([
      { path: ["tags", "page", "icon"], value: "file" },
    ]);
  });
});

describe("saving", () => {
  test("a save writes the changes and clears the draft", async () => {
    const { drafts, saved, world } = setup();
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    world.definitions.meeting = {
      schema: { type: "object", properties: { room: { type: "string" } } },
    };
    expect(await drafts.save("meeting")).toEqual({ ok: true, shadowed: [] });
    expect(saved).toHaveLength(1);
    expect(world.configText).toContain(SCHEMAS_MARKER);
    expect(drafts.draft("meeting")).toBeUndefined();
  });

  test("an invalid draft is refused with errors per attribute", async () => {
    const { drafts, saved } = setup();
    await ready(drafts);
    drafts.setRule("meeting", "", { type: "string" });
    drafts.setRule("meeting", "bad", { type: "nonsense" } as JsonSchema);
    const result = await drafts.save("meeting");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["", "bad"]);
    }
    expect(saved).toHaveLength(0);
    expect(drafts.draft("meeting")).toBeDefined();
  });

  test("a rename onto an existing attribute is refused", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.rename("page", "due", "name");
    const result = await drafts.save("page");
    expect(result.ok).toBe(false);
  });

  test("a failed save keeps the draft and returns the error", async () => {
    const { drafts } = setup(
      {},
      {
        save: async () => {
          throw new Error("disk full");
        },
      },
    );
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    expect(await drafts.save("meeting")).toMatchObject({
      ok: false,
      error: "disk full",
    });
    expect(drafts.draft("meeting")).toBeDefined();
  });

  test("a reload failure after writing says the save landed but didn't apply", async () => {
    const err = new ConfigReloadError("script error");
    const { drafts } = setup(
      {},
      {
        save: async () => {
          throw err;
        },
      },
    );
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    expect(await drafts.save("meeting")).toMatchObject({
      ok: false,
      savedButNotApplied: true,
    });
  });

  test("a save whose reload doesn't show the rule reports it shadowed", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.setRule("page", "category", { type: "string" });
    // A later script replaced page's schema, so category never shows up
    expect(await drafts.save("page")).toEqual({
      ok: true,
      shadowed: ["category"],
    });
  });

  test("the block changed by someone else since loading, for the same tag, is a conflict", async () => {
    const { drafts, world } = setup();
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    world.configText = applySchemaChanges(world.configText, {
      define: {
        meeting: { type: "object", properties: { seats: { type: "number" } } },
      },
      set: [],
      reset: [],
      require: [],
    });
    const result = await drafts.save("meeting");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/changed/);
  });

  test("a read-only space ignores edits", async () => {
    const { drafts } = setup({ writable: false });
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    expect(drafts.draft("meeting")).toBeUndefined();
  });

  test("an invalid schemas block is reported and refuses to save", async () => {
    const { drafts } = setup({
      configText: `\`\`\`space-lua\n${SCHEMAS_MARKER}\ntag.define {\n\`\`\`\n`,
    });
    await ready(drafts);
    expect(drafts.blockError).toBeDefined();
    drafts.setRule("meeting", "room", { type: "string" });
    expect((await drafts.save("meeting")).ok).toBe(false);
  });
});

describe("state", () => {
  test("a reload keeps drafts and refreshes the baseline", async () => {
    const { drafts, world, reload } = setup();
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    world.scripts = [];
    delete world.definitions.page;
    reload();
    await new Promise((r) => setTimeout(r, 0));
    expect(drafts.draft("meeting")).toBeDefined();
    expect(drafts.ownership("page")).toBe("none");
  });

  test("a failed load is reported, and a later one clears it", async () => {
    let fail = true;
    const base = setup();
    const { drafts, reload } = setup(
      {},
      {
        load: async () => {
          if (fail) throw new Error("Network error");
          return base.world;
        },
      },
    );
    await ready(drafts);
    expect(drafts.ready).toBe(false);
    expect(drafts.loadError).toBe("Couldn't read CONFIG: Network error");
    fail = false;
    reload();
    await new Promise((r) => setTimeout(r, 0));
    expect(drafts.ready).toBe(true);
    expect(drafts.loadError).toBeUndefined();
  });

  test("dirty toggles call onDirty once per change", async () => {
    const { drafts, onDirty } = setup();
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    drafts.setRule("meeting", "seats", { type: "number" });
    drafts.discard("meeting");
    expect(onDirty.mock.calls).toEqual([[true], [false]]);
    expect(drafts.dirty).toBe(false);
  });
});

describe("review fixes", () => {
  test("renaming twice after an edit moves the edited rule, leaving no ghost", async () => {
    const configText = applySchemaChanges("# Config\n", {
      define: {
        meeting: { type: "object", properties: { status: { type: "string" } } },
      },
      set: [],
      reset: [],
      require: [],
    });
    const { drafts } = setup({ configText });
    await ready(drafts);
    drafts.rename("meeting", "status", "state");
    drafts.setRule("meeting", "state", { type: "number" });
    drafts.rename("meeting", "status", "phase");
    expect(drafts.changesFor("meeting").define.meeting.properties).toEqual({
      phase: { type: "number" },
    });
  });

  test("resetting a renamed attribute undoes the rename", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.rename("page", "due", "deadline");
    drafts.reset("page", "due");
    const changes = drafts.changesFor("page");
    expect(changes.set).toEqual([]);
  });

  test("shadowing ignores key order", async () => {
    const { drafts, world } = setup();
    await ready(drafts);
    drafts.setRule("page", "category", { type: "string", description: "Kind" });
    world.definitions.page = {
      schema: {
        ...PAGE_SCHEMA,
        properties: {
          ...PAGE_SCHEMA.properties,
          category: { description: "Kind", type: "string" },
        },
      },
    };
    expect(await drafts.save("page")).toEqual({ ok: true, shadowed: [] });
  });

  test("an edit made while saving is kept as a draft", async () => {
    let release: () => void = () => {};
    const { drafts } = setup(
      {},
      {
        save: () =>
          new Promise<void>((r) => {
            release = r;
          }),
      },
    );
    await ready(drafts);
    drafts.setRule("meeting", "room", { type: "string" });
    const saving = drafts.save("meeting");
    await new Promise((r) => setTimeout(r, 0));
    drafts.setRule("meeting", "seats", { type: "number" });
    release();
    await saving;
    expect(drafts.draft("meeting")?.rules.get("seats")).toEqual({
      type: "number",
    });
  });

  test("no icon removes the tag's icon", async () => {
    const { drafts } = setup();
    await ready(drafts);
    drafts.setIcon("meeting", null);
    drafts.setIcon("page", null);
    expect(drafts.changesFor("meeting").set).toEqual([
      {
        path: ["tags", "meeting", "pageDecoration", "icon"],
        value: CONFIG_UNSET,
      },
    ]);
    expect(drafts.changesFor("page").set).toEqual([
      { path: ["tags", "page", "icon"], value: CONFIG_UNSET },
    ]);
  });

  test("definitions lists the scripts that give a tag its schema", async () => {
    const { drafts } = setup();
    await ready(drafts);
    expect(drafts.definitions("page")).toEqual([
      {
        ref: "Library/Std/Infrastructure/Root Tags@1",
        page: "Library/Std/Infrastructure/Root Tags",
      },
    ]);
    expect(drafts.definitions("meeting")).toEqual([]);
  });
});
