import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { persistConfigValue, saveManagedChanges } from "./config_page.ts";

type Handler = (...args: any[]) => any;

const MARKER = "-- managed-by: configuration-manager";

let handlers: Record<string, Handler>;
let calls: string[];
let written: string[];
const original = (globalThis as any).syscall;

beforeEach(() => {
  calls = [];
  written = [];
  handlers = {
    "space.writePage": (_name: string, text: string) => {
      written.push(text);
    },
    "sync.performFileSync": () => {},
    "mq.send": () => {},
    "mq.awaitEmptyQueue": () => {},
    "editor.reloadConfigAndCommands": () => {},
    "editor.rebuildEditorState": () => {},
  };
  (globalThis as any).syscall = async (name: string, ...args: any[]) => {
    calls.push(name);
    if (!handlers[name]) throw new Error(`Unexpected syscall: ${name}`);
    return handlers[name](...args);
  };
});

afterEach(() => {
  (globalThis as any).syscall = original;
});

function configPage(text: string) {
  handlers["space.readPage"] = () => text;
}

describe("saveManagedChanges", () => {
  test("rewrites a valid managed block", async () => {
    configPage(
      `# Config\n\n\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1)\n\`\`\`\n`,
    );
    await saveManagedChanges({ config: { set: { a: 2 }, unset: [] } });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(
      `# Config\n\n\`\`\`space-lua\n${MARKER}\nconfig.set("a", 2)\n\`\`\``,
    );
  });

  test("refuses to replace a managed block that is not valid Lua", async () => {
    configPage(
      `\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1)\nconfig.set("b", {\n\`\`\`\n`,
    );
    await expect(
      saveManagedChanges({ config: { set: { c: true }, unset: [] } }),
    ).rejects.toThrow(/not valid Lua/);
    expect(written).toEqual([]);
  });

  test("writes only what changed, and drops reset overrides", async () => {
    configPage(
      `\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1) -- mine\nconfig.set("b", 2)\ncommand.update { name = "X", key = "Ctrl-x" }\n\`\`\`\n`,
    );
    await saveManagedChanges({
      config: { set: { c: 3 }, unset: ["b"] },
      commands: { set: {}, unset: ["X"] },
    });
    expect(written[0]).toBe(
      `\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1) -- mine\nconfig.set("c", 3)\n\`\`\`\n`,
    );
  });

  test("reloads after writing", async () => {
    configPage(`\`\`\`space-lua\n${MARKER}\n\`\`\`\n`);
    await saveManagedChanges({ config: { set: { a: 1 }, unset: [] } });
    expect(calls.slice(-6)).toEqual([
      "space.writePage",
      "sync.performFileSync",
      "mq.send",
      "mq.awaitEmptyQueue",
      "editor.reloadConfigAndCommands",
      "editor.rebuildEditorState",
    ]);
  });
});

describe("reading CONFIG fails", () => {
  test("writes nothing when CONFIG can't be read", async () => {
    handlers["space.readPage"] = () => {
      throw new Error("Network error");
    };
    await expect(
      persistConfigValue("share.silverbullet.spaces", ["https://example.com"]),
    ).rejects.toThrow("Network error");
    expect(written).toEqual([]);
  });
});

describe("persistConfigValue", () => {
  test("creates CONFIG from the template", async () => {
    handlers["space.readPage"] = () => {
      throw new Error("Not found");
    };
    await persistConfigValue("share.silverbullet.spaces", [
      "https://example.com",
    ]);
    expect(written).toHaveLength(1);
    expect(written[0].startsWith("#meta\n")).toBe(true);
    expect(written[0]).toContain(
      `\`\`\`space-lua\n${MARKER}\nconfig.set("share.silverbullet.spaces", {"https://example.com"})\n\`\`\``,
    );
  });
});
