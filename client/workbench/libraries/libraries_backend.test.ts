import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addRepository,
  checkUpdates,
  installLibrary,
  updateAllRepositories,
  updateLibrary,
} from "./libraries_backend.ts";

type Handler = (...args: any[]) => any;

let handlers: Record<string, Handler>;
let calls: Array<[string, any[]]>;
const original = (globalThis as any).syscall;

beforeEach(() => {
  calls = [];
  handlers = {
    "mq.awaitEmptyQueue": () => {},
    "editor.reloadConfigAndCommands": () => {},
  };
  (globalThis as any).syscall = async (name: string, ...args: any[]) => {
    calls.push([name, args]);
    if (!handlers[name]) throw new Error(`Unexpected syscall: ${name}`);
    return handlers[name](...args);
  };
});

afterEach(() => {
  (globalThis as any).syscall = original;
});

const called = (name: string) => calls.filter(([n]) => n === name);

/** Answers share.install with `result`, and asset reads with their URI. */
function stubLua(result: Record<string, unknown>) {
  const expressions: string[] = [];
  handlers["lua.evalExpression"] = (expr: string) => {
    expressions.push(expr);
    if (expr.startsWith("share.install(")) return result;
    const asset = expr.match(/net\.readURI\("([^"]+)"/);
    if (asset) return btoa(asset[1]);
    throw new Error(`Unexpected expression: ${expr}`);
  };
  handlers["space.writeFile"] = () => {};
  handlers["system.loadPlug"] = () => {};
  return expressions;
}

describe("installing and updating", () => {
  test("install pulls through share.install, then writes its files beside the page", async () => {
    const expressions = stubLua({
      page: "Library/Acme/Tools",
      files: ["tools.plug.js", "icon.png", 3],
      changed: true,
    });
    expect(await installLibrary("https://example.com/lib/Tools.md")).toEqual({
      page: "Library/Acme/Tools",
    });
    expect(expressions[0]).toBe(
      'share.install("https://example.com/lib/Tools.md", {})',
    );
    expect(called("space.writeFile").map(([, [path]]) => path)).toEqual([
      "Library/Acme/tools.plug.js",
      "Library/Acme/icon.png",
    ]);
    expect(called("system.loadPlug").map(([, [path]]) => path)).toEqual([
      "Library/Acme/tools.plug.js",
    ]);
    expect(called("editor.reloadConfigAndCommands")).toHaveLength(1);
  });

  test("an unchanged update fetches nothing and reloads nothing", async () => {
    const expressions = stubLua({
      page: "Library/Acme/Tools",
      files: ["tools.plug.js"],
      changed: false,
    });
    expect(
      await updateLibrary({ name: "Library/Acme/Tools", uri: "u" }),
    ).toEqual({ changed: false });
    expect(expressions[0]).toBe(
      'share.install("u", {installed = "Library/Acme/Tools"})',
    );
    expect(called("space.writeFile")).toEqual([]);
    expect(called("editor.reloadConfigAndCommands")).toEqual([]);
  });

  test("a forced update says so", async () => {
    const expressions = stubLua({ page: "L", changed: true });
    expect(await updateLibrary({ name: "L", uri: "u" }, true)).toEqual({
      changed: true,
    });
    expect(expressions[0]).toBe(
      'share.install("u", {installed = "L", force = true})',
    );
  });

  test("a repository is pulled into the page asked for", async () => {
    const expressions = stubLua({ page: "Repositories/R", changed: true });
    await addRepository("u", "Repositories/R");
    expect(expressions[0]).toBe(
      'share.install("u", {page = "Repositories/R"})',
    );
  });

  test("a failing pull passes its error on", async () => {
    handlers["lua.evalExpression"] = () => {
      throw new Error("Page already exists: L");
    };
    await expect(installLibrary("u")).rejects.toThrow("Page already exists: L");
  });
});

describe("checkUpdates", () => {
  function stubIndex(evalExpression: (expr: string) => any) {
    handlers["index.queryLuaObjects"] = (tag: string) => {
      if (tag === "meta/library") {
        return [
          { name: "Library/A", share: { uri: "https://e/A.md", mode: "pull" } },
          { name: "Library/B", share: { uri: "https://e/B.md", mode: "push" } },
          {
            name: "Library/Std/C",
            share: { uri: "https://e/C.md", mode: "pull" },
          },
          { name: 'Library/Odd "x"\ny', share: { uri: "u", mode: "pull" } },
        ];
      }
      if (tag === "meta/repository") {
        return [
          {
            name: "Repositories/R",
            share: { uri: "https://e/R.md", mode: "pull" },
          },
          { name: "Repositories/Std" },
        ];
      }
      return [];
    };
    handlers["space.listPlugs"] = () => [];
    const expressions: string[] = [];
    handlers["lua.evalExpression"] = (expr: string) => {
      expressions.push(expr);
      return evalExpression(expr);
    };
    return expressions;
  }

  test("asks share.check for what Update would update, and repositories with a source", async () => {
    const expressions = stubIndex((expr) => {
      const name = JSON.parse(expr.slice("share.check({".length, -2));
      return { [name]: { state: "upToDate" } };
    });
    expect(Object.keys(await checkUpdates()).sort()).toEqual([
      "Library/A",
      'Library/Odd "x"\ny',
      "Repositories/R",
    ]);
    expect(expressions).toHaveLength(3);
    expect(expressions).toContain('share.check({"Library/A"})');
  });

  test("checks run side by side", async () => {
    let inFlight = 0;
    let most = 0;
    stubIndex(async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {};
    });
    await checkUpdates();
    expect(most).toBeGreaterThan(1);
  });

  test("nothing to report is an empty record", async () => {
    stubIndex(() => null);
    expect(await checkUpdates()).toEqual({});
  });
});

describe("updateAllRepositories", () => {
  test("shares every repository and reports which changed and which failed", async () => {
    handlers["index.queryLuaObjects"] = (tag: string) =>
      tag === "meta/repository"
        ? [
            ...["R", "S", "T"].map((name) => ({
              name,
              share: { uri: `https://e/${name}.md`, mode: "pull" },
            })),
            // The built-in Std has no source to update from
            { name: "Repositories/Std" },
          ]
        : [];
    handlers["space.listPlugs"] = () => [];
    const expressions: string[] = [];
    handlers["lua.evalExpression"] = (expr: string) => {
      expressions.push(expr);
      return {
        R: { ok: true, result: true },
        S: { ok: false, error: "boom" },
        T: { ok: true, result: false },
      };
    };
    expect(await updateAllRepositories()).toEqual({
      updated: ["R"],
      errors: ["S: boom"],
    });
    expect(expressions).toEqual(['share.shareMany({"R", "S", "T"})']);
  });
});
