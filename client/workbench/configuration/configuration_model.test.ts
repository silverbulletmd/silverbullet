import { describe, expect, test, vi } from "vitest";
import {
  applyManagedChanges,
  type ManagedChanges,
} from "../../config_management/managed_edit.ts";
import {
  type ConfigurationDeps,
  ConfigurationModel,
  type ConfigurationSource,
} from "./configuration_model.ts";

const MARKER = "-- managed-by: configuration-manager";

const managed = (body: string) =>
  `\`\`\`space-lua\n${MARKER}\n${body}\n\`\`\`\n`;

function source(configText: string, writable = true): ConfigurationSource {
  return {
    schemas: {
      type: "object",
      properties: {
        example: {
          type: "object",
          properties: {
            toggle: {
              type: "boolean",
              ui: { category: "Editor", label: "Example toggle" },
            },
            other: {
              type: "string",
              default: "x",
              ui: { category: "Editor", label: "Example other" },
            },
          },
        },
      },
    },
    values: { example: { toggle: false, other: "x" } },
    categories: {},
    commands: {
      "Example: One": { name: "Example: One", key: "Mod-k" },
      "Example: Two": { name: "Example: Two", key: "Mod-j" },
    },
    configText,
    isMac: false,
    writable,
  };
}

function setup(initial: ConfigurationSource) {
  let current = initial;
  let reload: () => void = () => {};
  const saved: ManagedChanges[] = [];
  // Library/Config as a save leaves it
  const write = (changes: ManagedChanges) => {
    saved.push(changes);
    current = {
      ...current,
      configText: applyManagedChanges(current.configText, changes),
    };
  };
  const deps: ConfigurationDeps = {
    load: async () => current,
    save: async (changes) => write(changes),
    subscribeReload: (changed) => {
      reload = changed;
      return () => {};
    },
    onDirty: vi.fn(),
  };
  const model = new ConfigurationModel(deps);
  model.subscribe(() => {});
  return {
    model,
    deps,
    saved,
    write,
    // A config reload with Library/Config now holding `text`
    reloadWith: async (text: string, { saves = false } = {}) => {
      current = { ...current, configText: text };
      reload();
      await flush();
      // A save made on load has written the file again
      if (!saves) expect(model.source?.configText).toBe(text);
    },
  };
}

// Let the model's async load settle; vi.waitFor would poll on a 50 ms timer.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function ready(model: ConfigurationModel) {
  await flush();
  expect(model.ready).toBe(true);
}

describe("ConfigurationModel", () => {
  test("loads baseline on first subscribe", async () => {
    const { model } = setup(
      source(managed('config.set("example.other", "y")')),
    );
    await ready(model);
    expect(model.valueOf("example.other")).toBe("y");
    expect(model.valueOf("example.toggle")).toBe(false);
    expect(model.dirty).toBe(false);
  });

  test("setField marks dirty and badges", async () => {
    const { model, deps } = setup(source(""));
    await ready(model);
    model.setField("example.toggle", true);
    expect(model.dirty).toBe(true);
    expect(deps.onDirty).toHaveBeenLastCalledWith(true);
    model.setField("example.toggle", false);
    expect(model.dirty).toBe(false);
    expect(deps.onDirty).toHaveBeenLastCalledWith(false);
  });

  test("rebaselines on reload and keeps pending edits", async () => {
    const { model, reloadWith } = setup(source(""));
    await ready(model);
    model.setField("example.toggle", true);
    await reloadWith(managed('config.set("example.other", "z")'));
    expect(model.valueOf("example.toggle")).toBe(true);
    expect(model.valueOf("example.other")).toBe("z");
    expect(model.changes().config).toEqual({
      set: { "example.toggle": true },
      unset: [],
    });
  });

  test("save is refused while the managed block is invalid", async () => {
    const { model, saved } = setup(source(managed('config.set("a", {')));
    await ready(model);
    expect(model.managedBlockError).toMatch(
      /^The managed configuration block in Library\/Config is not valid Lua/,
    );
    model.setField("example.toggle", true);
    await model.save();
    expect(saved).toEqual([]);
  });

  test("edits kept while the block is invalid save once it is fixed", async () => {
    const { model, saved, reloadWith } = setup(
      source(managed('config.set("a", {')),
    );
    await ready(model);
    model.commitField("example.toggle", true);
    await flush();
    expect(saved).toEqual([]);
    expect(model.dirty).toBe(true);
    await reloadWith("", { saves: true });
    await flush();
    expect(saved.map((c) => c.config?.set)).toEqual([
      { "example.toggle": true },
    ]);
  });

  test("commitNow loads, saves and settles without a subscriber", async () => {
    const saved: ManagedChanges[] = [];
    const model = new ConfigurationModel({
      load: async () => source(""),
      save: async (changes) => {
        saved.push(changes);
      },
      subscribeReload: () => () => {},
      onDirty: vi.fn(),
    });
    await model.commitNow("example.toggle", () => true);
    expect(saved.map((c) => c.config?.set)).toEqual([
      { "example.toggle": true },
    ]);
  });

  test("commitNow computes the value from what is loaded", async () => {
    const saved: ManagedChanges[] = [];
    const model = new ConfigurationModel({
      load: async () => source(""),
      save: async (changes) => {
        saved.push(changes);
      },
      subscribeReload: () => () => {},
      onDirty: vi.fn(),
    });
    await model.commitNow("example.other", async (current) => `${current}!`);
    expect(saved.map((c) => c.config?.set)).toEqual([
      { "example.other": "x!" },
    ]);
  });

  test("commitNow reloads a model that went stale after its tab closed", async () => {
    let other = "x";
    const seen: unknown[] = [];
    const model = new ConfigurationModel({
      load: async () => {
        const src = source("");
        src.values = { example: { toggle: false, other } };
        return src;
      },
      save: async () => {},
      subscribeReload: () => () => {},
      onDirty: vi.fn(),
    });
    const release = model.subscribe(() => {});
    await flush();
    release();
    other = "changed elsewhere";
    await model.commitNow("example.other", (current) => {
      seen.push(current);
      return "y";
    });
    expect(seen).toEqual(["changed elsewhere"]);
  });

  test("commitNow rejects when the space is read-only", async () => {
    const model = new ConfigurationModel({
      load: async () => source("", false),
      save: vi.fn(),
      subscribeReload: () => () => {},
      onDirty: vi.fn(),
    });
    await expect(
      model.commitNow("example.toggle", () => true),
    ).rejects.toThrow();
  });

  test("commitField saves right away; setField waits for save", async () => {
    const { model, saved } = setup(source(""));
    await ready(model);
    model.setField("example.other", "typed");
    await flush();
    expect(saved).toEqual([]);
    model.commitField("example.toggle", true);
    await flush();
    expect(saved.map((c) => c.config?.set)).toEqual([
      { "example.toggle": true, "example.other": "typed" },
    ]);
  });

  test("key binding and reset edits save right away", async () => {
    const { model, saved } = setup(
      source(managed('config.set("example.other", "y")')),
    );
    await ready(model);
    model.commit("Example: One", 0, ["Mod-u"]);
    await flush();
    model.resetField("example.other");
    await flush();
    expect(saved).toHaveLength(2);
    expect(saved[0].commands?.set).toHaveProperty("Example: One");
    expect(saved[1].config?.unset).toEqual(["example.other"]);
  });

  test("an edit made while saving is saved next, not lost", async () => {
    const { model, saved, deps, write } = setup(source(""));
    await ready(model);
    let release!: () => void;
    deps.save = async (changes) => {
      write(changes);
      if (saved.length === 1) {
        await new Promise<void>((r) => {
          release = r;
        });
      }
    };
    model.commitField("example.toggle", true);
    await flush();
    expect(model.saving).toBe(true);
    model.commitField("example.other", "later");
    release();
    await flush();
    await flush();
    expect(saved.map((c) => c.config?.set)).toEqual([
      { "example.toggle": true },
      // The first edit landed, so only the new one goes out
      { "example.other": "later" },
    ]);
    expect(model.saving).toBe(false);
    expect(model.valueOf("example.other")).toBe("later");
  });

  test("a failed save keeps the edits and can be retried", async () => {
    const { model, saved, deps } = setup(source(""));
    await ready(model);
    deps.save = async () => {
      throw new Error("Disk full");
    };
    model.commitField("example.toggle", true);
    await flush();
    expect(model.saveError).toBe("Failed to save: Disk full");
    expect(model.dirty).toBe(true);
    deps.save = async (changes) => {
      saved.push(changes);
    };
    await model.save();
    expect(saved).toHaveLength(1);
    expect(model.saveError).toBeUndefined();
  });

  test("revertField drops an unsaved edit", async () => {
    const { model } = setup(source(""));
    await ready(model);
    model.setField("example.other", "typed");
    model.revertField("example.other");
    expect(model.dirty).toBe(false);
    expect(model.valueOf("example.other")).toBe("x");
  });

  test("the badge shows unsaved edits, not a save in flight", async () => {
    const { model, deps } = setup(source(""));
    await ready(model);
    let release!: () => void;
    deps.save = () =>
      new Promise<void>((r) => {
        release = r;
      });
    model.commitField("example.toggle", true);
    await flush();
    expect(deps.onDirty).not.toHaveBeenCalledWith(true);
    release();
  });

  test("save writes only changes, then clears dirty", async () => {
    const { model, saved, reloadWith } = setup(source(""));
    await ready(model);
    model.setField("example.toggle", true);
    const expected = model.changes();
    await model.save();
    expect(saved).toEqual([expected]);
    await reloadWith(managed('config.set("example.toggle", true)'));
    expect(model.dirty).toBe(false);
  });

  test("discard restores the baseline", async () => {
    const { model } = setup(source(""));
    await ready(model);
    model.setField("example.toggle", true);
    model.commit("Example: One", 0, ["Mod-u"]);
    model.discard();
    expect(model.dirty).toBe(false);
    expect(model.valueOf("example.toggle")).toBe(false);
    expect(model.resolvedBindings("Example: One")).toEqual(["Mod-k"]);
  });

  test("commit refuses a duplicate chord", async () => {
    const { model } = setup(source(""));
    await ready(model);
    const conflicts = model.commit("Example: One", 0, ["Mod-j"]);
    expect(conflicts?.duplicate).toHaveLength(1);
    expect(model.pending.commands).toEqual({});
    expect(model.commit("Example: One", 0, ["Mod-u"])).toBe(null);
    expect(model.resolvedBindings("Example: One")).toEqual(["Mod-u"]);
    expect(model.isBindingModified("Example: One")).toBe(true);
  });

  test("old manager output loads without unsaved changes", async () => {
    const { model, deps } = setup(
      source(
        managed('command.update { name = "Example: One", key = "Mod-u" }'),
      ),
    );
    await ready(model);
    expect(model.dirty).toBe(false);
    expect(deps.onDirty).not.toHaveBeenCalledWith(true);
    expect(model.unsavedCount).toBe(0);
    expect(model.resolvedBindings("Example: One")).toEqual(["Mod-u"]);
  });

  test("the next save repairs old manager output", async () => {
    const { model, saved } = setup(
      source(
        managed('command.update { name = "Example: One", key = "Mod-u" }'),
      ),
    );
    await ready(model);
    model.setField("example.toggle", true);
    await model.save();
    expect(saved[0].commands).toEqual({
      set: { "Example: One": { key: "Mod-u", mac: "" } },
      unset: [],
    });
  });

  test("a failed load shows the error", async () => {
    const deps: ConfigurationDeps = {
      load: async () => {
        throw new Error("Network error");
      },
      save: async () => {},
      subscribeReload: () => () => {},
      onDirty: () => {},
    };
    const model = new ConfigurationModel(deps);
    model.subscribe(() => {});
    await flush();
    expect(model.loadError).toBe("Couldn't read Library/Config: Network error");
    expect(model.ready).toBe(false);
  });

  test("changes leave overrides without a field alone", async () => {
    const { model } = setup(
      source(
        managed(
          'config.set("share.silverbullet.spaces", {"https://example.com"})',
        ),
      ),
    );
    await ready(model);
    model.setField("example.toggle", true);
    expect(model.changes().config).toEqual({
      set: { "example.toggle": true },
      unset: [],
    });
  });

  test("a reset field shows its default until saved", async () => {
    const { model } = setup(
      source(managed('config.set("example.other", "y")')),
    );
    await ready(model);
    model.resetField("example.other");
    expect(model.valueOf("example.other")).toBe("x");
    expect(model.isModified("example.other")).toBe(false);
    expect(model.changes().config).toEqual({
      set: {},
      unset: ["example.other"],
    });
  });

  test("edits are ignored when not writable", async () => {
    const { model } = setup(source("", false));
    await ready(model);
    model.setField("example.toggle", true);
    model.commit("Example: One", 0, ["Mod-u"]);
    expect(model.dirty).toBe(false);
  });
});
