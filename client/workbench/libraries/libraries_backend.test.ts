import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addRepository,
  checkUpdates,
  installLibrary,
  listLibraries,
  removeLibrary,
  updateAllRepositories,
  updateByName,
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

/** Pages by name, as their frontmatter. */
function stubPages(pages: Record<string, Record<string, unknown>>) {
  handlers["space.readPage"] = (name: string) => {
    if (!pages[name]) throw new Error(`Not found: ${name}`);
    return JSON.stringify(pages[name]);
  };
  handlers["system.invokeFunction"] = (fn: string, text: string) => {
    if (fn !== "index.extractFrontmatter") throw new Error(`Unexpected ${fn}`);
    return { frontmatter: JSON.parse(text) };
  };
}

/**
 * Answers share.install with `result`, share.libraryInfo with a library like
 * it that requires nothing, and asset reads with their URI.
 */
function stubLua(result: Record<string, unknown>) {
  const expressions: string[] = [];
  handlers["index.queryLuaObjects"] = () => [];
  handlers["lua.evalExpression"] = (expr: string) => {
    expressions.push(expr);
    if (expr.startsWith("share.install(")) return result;
    if (expr.startsWith("share.installInfo(")) return null;
    if (expr.startsWith("share.libraryInfo(")) {
      const uri = JSON.parse(expr.slice("share.libraryInfo(".length, -1));
      return { ...result, uri, exists: false, text: "# Tools" };
    }
    const asset = expr.match(/net\.readURI\("([^"]+)"/);
    if (asset) return btoa(asset[1]);
    throw new Error(`Unexpected expression: ${expr}`);
  };
  handlers["space.writeFile"] = () => {};
  handlers["system.loadPlug"] = () => {};
  return expressions;
}

describe("available library links", () => {
  test("uses a configured website or expands the source URI to a browser URL", async () => {
    handlers["index.queryLuaObjects"] = (tag: string) =>
      tag === "meta/library/remote"
        ? [
            {
              name: "Custom",
              uri: "github:acme/tools@main/Custom.md",
              website: "https://example.com/custom",
            },
            { name: "Source", uri: "github:acme/tools@dev/Source.md" },
            { name: "HTTPS", uri: "https://example.com/Library.md" },
            { name: "Local", uri: "local:Library.md" },
          ]
        : [];
    handlers["space.listPlugs"] = () => [];
    handlers["lua.evalExpression"] = (expression: string) => {
      switch (expression) {
        case 'share.webUrl("github:acme/tools@dev/Source.md")':
          return "https://github.com/acme/tools/blob/dev/Source.md";
        case 'share.webUrl("https://example.com/Library.md")':
          return "https://example.com/Library.md";
        case 'share.webUrl("local:Library.md")':
          return null;
        default:
          throw new Error(`Unexpected Lua expression: ${expression}`);
      }
    };
    const { installable } = await listLibraries();
    expect(installable.map((lib) => [lib.name, lib.website])).toEqual([
      ["Custom", "https://example.com/custom"],
      ["Source", "https://github.com/acme/tools/blob/dev/Source.md"],
      ["HTTPS", "https://example.com/Library.md"],
      ["Local", undefined],
    ]);
  });
});

describe("installing and updating", () => {
  test("install reads the library once, writes what it read, then its files beside the page", async () => {
    const expressions = stubLua({
      page: "Library/Acme/Tools",
      files: ["tools.plug.js", "icon.png", 3],
      changed: true,
    });
    expect(await installLibrary("https://example.com/lib/Tools.md")).toEqual({
      page: "Library/Acme/Tools",
      requirements: [],
    });
    expect(expressions.slice(0, 2)).toEqual([
      'share.libraryInfo("https://example.com/lib/Tools.md")',
      'share.installInfo({uri = "https://example.com/lib/Tools.md", page = "Library/Acme/Tools", text = "# Tools"})',
    ]);
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
    stubPages({ "Library/Acme/Tools": {} });
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
    stubPages({ L: {} });
    expect(await updateLibrary({ name: "L", uri: "u" }, true)).toEqual({
      changed: true,
    });
    expect(expressions[0]).toBe(
      'share.install("u", {installed = "L", force = true})',
    );
  });

  test("a repository is pulled into the page asked for", async () => {
    const expressions = stubLua({
      page: "Library/Repository/R",
      changed: true,
    });
    await addRepository("u", "Library/Repository/R");
    expect(expressions[0]).toBe(
      'share.install("u", {page = "Library/Repository/R"})',
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

describe("updateByName", () => {
  function stubSpace(evalExpression: (expr: string) => any) {
    handlers["index.queryLuaObjects"] = (tag: string) => {
      if (tag === "meta/library") {
        return [
          { name: "Library/A", share: { uri: "https://e/A.md", mode: "pull" } },
          { name: "Library/B", share: { uri: "https://e/B.md", mode: "push" } },
        ];
      }
      if (tag === "meta/repository") {
        return [{ name: "Repositories/R", share: { uri: "https://e/R.md" } }];
      }
      return [];
    };
    handlers["space.listPlugs"] = () => [];
    handlers["lua.evalExpression"] = evalExpression;
  }

  test("a repository goes through share.sharePage", async () => {
    const expressions: string[] = [];
    stubSpace((expr) => {
      expressions.push(expr);
      return true;
    });
    expect(await updateByName("Repositories/R")).toEqual({ changed: true });
    expect(expressions).toEqual(['share.sharePage("Repositories/R")']);
  });

  test("an updatable library is pulled again", async () => {
    const expressions: string[] = [];
    stubPages({ "Library/A": {} });
    stubSpace((expr) => {
      expressions.push(expr);
      return { page: "Library/A", changed: false };
    });
    expect(await updateByName("Library/A")).toEqual({ changed: false });
    expect(expressions).toEqual([
      'share.install("https://e/A.md", {installed = "Library/A"})',
    ]);
  });

  test.each(["Library/B", "Library/Missing"])(
    "%s is not an installed library or repository",
    async (name) => {
      stubSpace(() => {
        throw new Error("must not be reached");
      });
      await expect(updateByName(name)).rejects.toThrow(
        `Not an installed library or repository: ${name}`,
      );
    },
  );
});

describe("repositories under Library/Repository", () => {
  test("a library several repositories list is offered once", async () => {
    handlers["index.queryLuaObjects"] = (tag: string) =>
      tag === "meta/library/remote"
        ? [
            { name: "Foo", uri: "u", page: "Library/Repository/Std" },
            { name: "Foo", uri: "u", page: "Library/Repository/Other" },
            { name: "Bar", uri: "v", page: "Library/Repository/Other" },
          ]
        : [];
    handlers["space.listPlugs"] = () => [];
    handlers["lua.evalExpression"] = () => null;
    const { installable } = await listLibraries();
    expect(installable.map((l) => [l.uri, l.repositoryPage])).toEqual([
      ["u", "Library/Repository/Std"],
      ["v", "Library/Repository/Other"],
    ]);
  });

  test("adding a repository nests the page under Library/Repository", async () => {
    const expressions = stubLua({ page: "x", changed: true });
    await addRepository("u", "Foo");
    expect(expressions[0]).toBe(
      'share.install("u", {page = "Library/Repository/Foo"})',
    );
    await addRepository("u", "Library/Repository/Bar");
    expect(expressions[1]).toBe(
      'share.install("u", {page = "Library/Repository/Bar"})',
    );
  });
});

describe("requirements", () => {
  const BASE = "github:acme/libs@main/";
  type Remote = { page: string; requires?: unknown; files?: string[] };

  /**
   * Remote libraries by URI and the installed ones; returns the URIs whose
   * pages were written, in order, and the paths deleted.
   */
  function stubRemotes(
    remotes: Record<string, Remote>,
    installed: Array<{ name: string; uri: string; requires?: string[] }> = [],
    opts: { failInstall?: string; failFile?: string; existing?: string[] } = {},
  ) {
    const pulled: string[] = [];
    const deleted: string[] = [];
    handlers["index.queryLuaObjects"] = (tag: string) =>
      tag === "meta/library"
        ? installed.map((l) => ({
            name: l.name,
            share: { uri: l.uri, mode: "pull" },
            requires: l.requires,
          }))
        : [];
    handlers["space.listPlugs"] = () => [];
    handlers["space.writeFile"] = () => {};
    handlers["space.deleteFile"] = (path: string) => {
      deleted.push(path);
    };
    handlers["space.deletePage"] = (name: string) => {
      deleted.push(name);
    };
    handlers["system.loadPlug"] = () => {};
    handlers["system.unloadPlug"] = () => {};
    handlers["lua.evalExpression"] = (expr: string) => {
      const info = expr.match(/^share\.libraryInfo\("([^"]+)"\)$/);
      if (info) {
        const r = remotes[info[1]];
        if (!r) throw new Error(`Could not fetch ${info[1]}`);
        return {
          uri: info[1],
          page: r.page,
          requires: r.requires,
          files: r.files,
          exists:
            installed.some((l) => l.name === r.page) ||
            !!opts.existing?.includes(r.page),
          text: "",
        };
      }
      const install =
        expr.match(/^share\.install\("([^"]+)", \{.*\}\)$/) ??
        expr.match(/^share\.installInfo\(\{uri = "([^"]+)"/);
      if (install) {
        const uri = install[1];
        if (uri === opts.failInstall) throw new Error("network down");
        pulled.push(uri);
        return {
          page: remotes[uri].page,
          files: remotes[uri].files,
          changed: true,
        };
      }
      const asset = expr.match(/net\.readURI\("([^"]+)"/);
      if (asset) {
        if (asset[1] === opts.failFile) throw new Error("file fetch failed");
        return btoa(asset[1]);
      }
      if (expr.startsWith("share.webUrl(")) return null;
      throw new Error(`Unexpected expression: ${expr}`);
    };
    return { pulled, deleted };
  }

  test("installing pulls missing requirements first, deepest first, then reloads once", async () => {
    const { pulled } = stubRemotes(
      {
        [`${BASE}Themes/Paper.md`]: {
          page: "Library/acme/Themes/Paper",
          requires: [
            "../Fonts/Lora.md",
            "github:other/fonts@v1/Inter.md",
            "../Fonts/Mono.md",
            "../Fonts/Serif.md",
          ],
        },
        [`${BASE}Fonts/Lora.md`]: {
          page: "Library/acme/Fonts/Lora",
          requires: ["Base.md"],
        },
        [`${BASE}Fonts/Base.md`]: { page: "Library/acme/Fonts/Base" },
        "github:other/fonts@v1/Inter.md": { page: "Library/other/Inter" },
        [`${BASE}Fonts/Mono.md`]: { page: "Library/acme/Fonts/Mono" },
        [`${BASE}Fonts/Serif.md`]: { page: "Library/acme/Fonts/Serif" },
      },
      // Installed from the same file under its web URL
      [
        {
          name: "Library/acme/Fonts/Mono",
          uri: "https://github.com/acme/libs/blob/main/Fonts/Mono.md",
        },
      ],
      // A page of that name is there already, installed or not
      { existing: ["Library/acme/Fonts/Serif"] },
    );
    expect(await installLibrary(`${BASE}Themes/Paper.md`)).toEqual({
      page: "Library/acme/Themes/Paper",
      requirements: [
        "Library/acme/Fonts/Base",
        "Library/acme/Fonts/Lora",
        "Library/other/Inter",
      ],
    });
    expect(pulled).toEqual([
      `${BASE}Fonts/Base.md`,
      `${BASE}Fonts/Lora.md`,
      "github:other/fonts@v1/Inter.md",
      `${BASE}Themes/Paper.md`,
    ]);
    expect(called("editor.reloadConfigAndCommands")).toHaveLength(1);
  });

  test("a cycle installs each library once and doesn't fail", async () => {
    const { pulled } = stubRemotes({
      [`${BASE}A.md`]: { page: "Library/A", requires: ["B.md", "A.md"] },
      [`${BASE}B.md`]: { page: "Library/B", requires: ["A.md", "B.md"] },
    });
    await installLibrary(`${BASE}A.md`);
    expect(pulled).toEqual([`${BASE}B.md`, `${BASE}A.md`]);
  });

  test("a requirement that can't be read fails the install before anything is written", async () => {
    const { pulled } = stubRemotes({
      [`${BASE}Themes/Paper.md`]: {
        page: "Library/acme/Themes/Paper",
        requires: ["../Fonts/Gone.md"],
      },
    });
    await expect(installLibrary(`${BASE}Themes/Paper.md`)).rejects.toThrow(
      `Could not install Gone (required by Paper): Could not fetch ${BASE}Fonts/Gone.md`,
    );
    expect(pulled).toEqual([]);
    expect(called("editor.reloadConfigAndCommands")).toEqual([]);
  });

  test.each([
    [
      "../../x.md",
      `Paper requires "../../x.md", which doesn't resolve against ${BASE}Paper.md`,
    ],
    [
      "/Lora.md",
      'Paper requires "/Lora.md": start a relative path with ./ or ../, or give a full URI',
    ],
  ])(
    "a requirement %s that can't be used fails the install",
    async (entry, error) => {
      const { pulled } = stubRemotes({
        [`${BASE}Paper.md`]: { page: "Library/Paper", requires: [entry] },
      });
      await expect(installLibrary(`${BASE}Paper.md`)).rejects.toThrow(error);
      expect(pulled).toEqual([]);
    },
  );

  test("an existing library page fails the install before its requirements are pulled", async () => {
    const { pulled } = stubRemotes(
      {
        [`${BASE}Paper.md`]: { page: "Library/Paper", requires: ["Lora.md"] },
        [`${BASE}Lora.md`]: { page: "Library/Lora" },
      },
      [],
      { existing: ["Library/Paper"] },
    );
    await expect(installLibrary(`${BASE}Paper.md`)).rejects.toThrow(
      "Page already exists: Library/Paper",
    );
    expect(pulled).toEqual([]);
  });

  describe("a failing install takes back what it wrote, last first, and only that", () => {
    const remotes: Record<string, Remote> = {
      [`${BASE}Paper.md`]: {
        page: "Library/Paper",
        requires: ["Lora.md", "Base.md"],
        files: ["Paper/a.css"],
      },
      [`${BASE}Lora.md`]: { page: "Library/Lora", files: ["Lora/a.ttf"] },
      [`${BASE}Base.md`]: { page: "Library/Base" },
    };
    const LORA = ["Library/Lora/a.ttf", "Library/Lora"];
    test.each([
      {
        what: "a requirement's page",
        fail: { failInstall: `${BASE}Base.md` },
        error: "Could not install Base (required by Paper): network down",
        pulled: ["Lora"],
        deleted: LORA,
      },
      {
        what: "a requirement's files",
        fail: { failFile: `${BASE}Lora/a.ttf` },
        error: "Could not install Lora (required by Paper): file fetch failed",
        pulled: ["Lora"],
        deleted: LORA,
      },
      {
        what: "the library's own page",
        fail: { failInstall: `${BASE}Paper.md` },
        error: "network down",
        pulled: ["Lora", "Base"],
        deleted: ["Library/Base", ...LORA],
      },
      {
        what: "the library's files",
        fail: { failFile: `${BASE}Paper/a.css` },
        error: "file fetch failed",
        pulled: ["Lora", "Base", "Paper"],
        deleted: [
          "Library/Paper/a.css",
          "Library/Paper",
          "Library/Base",
          ...LORA,
        ],
      },
      {
        what: "the library's own page, with a requirement installed before",
        installed: [{ name: "Library/Lora", uri: `${BASE}Lora.md` }],
        fail: { failInstall: `${BASE}Paper.md` },
        error: "network down",
        pulled: ["Base"],
        deleted: ["Library/Base"],
      },
    ])("$what failing", async (c) => {
      const { pulled, deleted } = stubRemotes(
        remotes,
        c.installed ?? [],
        c.fail,
      );
      await expect(installLibrary(`${BASE}Paper.md`)).rejects.toThrow(c.error);
      expect(pulled).toEqual(c.pulled.map((n) => `${BASE}${n}.md`));
      expect(deleted).toEqual(c.deleted);
      expect(called("editor.reloadConfigAndCommands")).toEqual([]);
    });
  });

  test("a reload failing after a complete install takes nothing back", async () => {
    const { deleted } = stubRemotes({
      [`${BASE}Paper.md`]: { page: "Library/Paper", requires: ["Lora.md"] },
      [`${BASE}Lora.md`]: { page: "Library/Lora" },
    });
    handlers["editor.reloadConfigAndCommands"] = () => {
      throw new Error("reload failed");
    };
    await expect(installLibrary(`${BASE}Paper.md`)).rejects.toThrow(
      "reload failed",
    );
    expect(deleted).toEqual([]);
  });

  test("a requirement failing after an update says the library was updated", async () => {
    stubRemotes(
      {
        [`${BASE}Paper.md`]: { page: "Library/Paper" },
        [`${BASE}Inter.md`]: { page: "Library/Inter" },
      },
      [{ name: "Library/Paper", uri: `${BASE}Paper.md` }],
      { failInstall: `${BASE}Inter.md` },
    );
    stubPages({ "Library/Paper": { requires: ["Inter.md"] } });
    await expect(
      updateLibrary({ name: "Library/Paper", uri: `${BASE}Paper.md` }),
    ).rejects.toThrow(
      "Updated Paper, but: Could not install Inter (required by Paper): network down",
    );
    expect(called("editor.reloadConfigAndCommands")).toHaveLength(1);
  });

  test("an update installs requirements added since, leaving installed ones alone", async () => {
    const { pulled } = stubRemotes(
      {
        [`${BASE}Paper.md`]: { page: "Library/Paper" },
        [`${BASE}Lora.md`]: { page: "Library/Lora" },
        [`${BASE}Inter.md`]: { page: "Library/Inter" },
      },
      [
        { name: "Library/Paper", uri: `${BASE}Paper.md` },
        { name: "Library/Lora", uri: `${BASE}Lora.md` },
      ],
    );
    // The page as the update left it
    stubPages({ "Library/Paper": { requires: ["Lora.md", "Inter.md"] } });
    expect(
      await updateLibrary({ name: "Library/Paper", uri: `${BASE}Paper.md` }),
    ).toEqual({ changed: true });
    expect(pulled).toEqual([`${BASE}Paper.md`, `${BASE}Inter.md`]);
    expect(called("editor.reloadConfigAndCommands")).toHaveLength(1);
  });

  test("removing a library deletes its page and files, not what it requires", async () => {
    const { deleted } = stubRemotes({}, [
      { name: "Library/acme/Fonts/Lora", uri: `${BASE}Fonts/Lora.md` },
      {
        name: "Library/acme/Themes/Paper",
        uri: `${BASE}Themes/Paper.md`,
        requires: ["../Fonts/Lora.md"],
      },
    ]);
    stubPages({ "Library/acme/Themes/Paper": { files: ["Paper/a.css"] } });
    await removeLibrary("Library/acme/Themes/Paper");
    expect(deleted).toEqual([
      "Library/acme/Themes/Paper/a.css",
      "Library/acme/Themes/Paper",
    ]);
  });

  test("the lists carry requirements as full URIs", async () => {
    stubRemotes({}, [
      {
        name: "Library/acme/Themes/Paper",
        uri: `${BASE}Themes/Paper.md`,
        requires: ["../Fonts/Lora.md"],
      },
    ]);
    const queryLibraries = handlers["index.queryLuaObjects"];
    handlers["index.queryLuaObjects"] = (tag: string) =>
      tag === "meta/library/remote"
        ? [
            {
              name: "Ink",
              uri: `${BASE}Themes/Ink.md`,
              requires: ["../Fonts/Lora.md", "/Fonts/Inter.md"],
            },
          ]
        : queryLibraries(tag);
    const { installed, installable } = await listLibraries();
    expect(installed[0].requires).toEqual([`${BASE}Fonts/Lora.md`]);
    expect(installable[0].requires).toEqual([`${BASE}Fonts/Lora.md`]);
    expect(installable[0].requireErrors).toEqual([
      '"/Fonts/Inter.md": start a relative path with ./ or ../, or give a full URI',
    ]);
  });

  test("an installed library is named as a repository lists it", async () => {
    stubRemotes({}, [
      {
        name: "Library/acme/Fonts/EBGaramond",
        uri: `${BASE}Fonts/EBGaramond.md`,
      },
      { name: "Library/acme/Fonts/Lora", uri: `${BASE}Fonts/Lora.md` },
    ]);
    const queryLibraries = handlers["index.queryLuaObjects"];
    handlers["index.queryLuaObjects"] = (tag: string) =>
      tag === "meta/library/remote"
        ? [
            {
              name: "EB Garamond",
              // The same file as a github.com URL
              uri: "https://github.com/acme/libs/blob/main/Fonts/EBGaramond.md",
            },
          ]
        : queryLibraries(tag);
    const { installed } = await listLibraries();
    expect(installed.map((l) => l.displayName)).toEqual([
      "EB Garamond",
      undefined,
    ]);
  });
});
