import { describe, expect, test, vi } from "vitest";
import type { ManagedChanges } from "../../config_management/managed_edit.ts";
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
  const deps: ConfigurationDeps = {
    load: async () => current,
    save: async (changes) => {
      saved.push(changes);
    },
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
    // A config reload with CONFIG now holding `text`
    reloadWith: async (text: string) => {
      current = { ...current, configText: text };
      reload();
      await vi.waitFor(() => expect(model.source?.configText).toBe(text));
    },
  };
}

async function ready(model: ConfigurationModel) {
  await vi.waitFor(() => expect(model.ready).toBe(true));
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
      /^The managed configuration block in CONFIG is not valid Lua/,
    );
    model.setField("example.toggle", true);
    await model.save();
    expect(saved).toEqual([]);
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
    await vi.waitFor(() =>
      expect(model.loadError).toBe("Couldn't read CONFIG: Network error"),
    );
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
