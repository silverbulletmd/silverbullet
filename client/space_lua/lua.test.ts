import { expect, test } from "vitest";
import { parseBlock } from "./parse.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame, LuaTable } from "./runtime.ts";
import { evalStatement } from "./eval.ts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { validateObject } from "../plugos/syscalls/jsonschema.ts";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Core Lua tests (bare stdlib env)
const testFiles = readdirSync(__dirname, { recursive: true })
  .filter((f): f is string => typeof f === "string" && f.endsWith("_test.lua"))
  .sort();

for (const file of testFiles) {
  test(`[Lua] ${file}`, async () => {
    await runLuaTest(`./${file}`);
  });
}

// Library API Lua tests (stdlib + jsonschema + library code pre-loaded)
const libraryApisDir = resolve(__dirname, "../../libraries/Library/Std/APIs");
const libraryTestFiles = readdirSync(libraryApisDir, { recursive: true })
  .filter((f): f is string => typeof f === "string" && f.endsWith("_test.lua"))
  .sort();

for (const file of libraryTestFiles) {
  // A test file may declare its companion library .md explicitly via a header
  // comment on (any of) its first lines, e.g. "-- companion: Code Widget.md".
  // This is required for multi-word library pages that the derivation below
  // cannot reach.
  const testSource = readFileSync(resolve(libraryApisDir, file), "utf-8");
  const companionMatch = testSource.match(/^--\s*companion:\s*(.+?)\s*$/m);
  let libraryMdPath: string;
  if (companionMatch) {
    libraryMdPath = resolve(libraryApisDir, companionMatch[1]);
  } else {
    // Derive the companion library .md name from the test file name, e.g.
    // "widget_sandbox_test.lua" → "Widget.md".
    // NOTE: only the first snake_case segment is used, so this scheme cannot
    // reach multi-word library pages (e.g. "Task State.md", "DOM.md"). Such a
    // test should declare its companion path explicitly via the header comment
    // above rather than relying on this derivation.
    const libraryName = file
      .replace(/_test\.lua$/, "")
      // Convert snake_case segment to PascalCase for the .md filename, keeping
      // only the first segment so "widget_sandbox" → "Widget"
      .split("_")[0]
      .replace(/^./, (c) => c.toUpperCase());
    libraryMdPath = resolve(libraryApisDir, `${libraryName}.md`);
  }
  test(`[Lua] ${file}`, async () => {
    await runLuaTest(resolve(libraryApisDir, file), {
      isAbsolutePath: true,
      preloadMdPath: libraryMdPath,
    });
  });
}

async function runLuaTest(
  luaPath: string,
  opts: { isAbsolutePath?: boolean; preloadMdPath?: string } = {},
) {
  if (
    typeof globalThis.client !== "undefined" &&
    globalThis.client &&
    typeof globalThis.client === "object"
  ) {
    if (
      !globalThis.client.config ||
      typeof globalThis.client.config.get !== "function"
    ) {
      try {
        Object.defineProperty(globalThis.client, "config", {
          value: {
            get(_key: string, fallback: unknown) {
              return fallback ?? {};
            },
          },
          configurable: true,
          writable: true,
        });
      } catch {
        // ignore
      }
    }
  } else {
    (globalThis as any).client = {
      config: {
        get(_key: string, fallback: unknown) {
          return fallback ?? {};
        },
      },
    };
  }

  const resolvedPath = opts.isAbsolutePath
    ? luaPath
    : fileURLToPath(new URL(luaPath, import.meta.url));
  const luaFile = await readFile(resolvedPath, "utf-8");
  const chunk = parseBlock(luaFile, {});
  const env = new LuaEnv(luaBuildStandardEnv());

  // If a companion .md library file is provided, extract its space-lua block(s)
  // and run them in the env first, after injecting any required syscall stubs.
  if (opts.preloadMdPath) {
    // Provide a minimal jsonschema table so widget.new validation works
    const jsonschemaTbl = new LuaTable();
    await jsonschemaTbl.set("validateObject", (schema: any, obj: any) =>
      validateObject(schema, obj),
    );
    env.set("jsonschema", jsonschemaTbl);

    // Provide a minimal in-memory `config` table (normally syscall-backed) so
    // library APIs that wrap config.get/config.set (e.g. command.define,
    // codeWidget.define) work in the bare test env. Values are stored as their
    // raw Lua values (no JS conversion) so e.g. function fields survive a
    // set/get round trip.
    const configStore = new Map<string, unknown>();
    const pathToKey = (path: unknown): string => {
      if (path instanceof LuaTable) {
        const parts: string[] = [];
        for (let i = 1; i <= path.length; i++) {
          parts.push(String(path.get(i)));
        }
        return parts.join("\0");
      }
      // string path: support dot notation like the real config API
      return String(path).split(".").join("\0");
    };
    const configTbl = new LuaTable();
    await configTbl.set("set", (path: unknown, value: unknown) => {
      configStore.set(pathToKey(path), value);
    });
    await configTbl.set("get", (path: unknown, defaultValue: unknown) => {
      const key = pathToKey(path);
      return configStore.has(key)
        ? configStore.get(key)
        : (defaultValue ?? null);
    });
    env.set("config", configTbl);

    let mdText: string;
    try {
      mdText = await readFile(opts.preloadMdPath, "utf-8");
    } catch {
      throw new Error(`Library preload file not found: ${opts.preloadMdPath}`);
    }
    const libLua = extractSpaceLuaFromPageText(mdText);
    if (libLua) {
      const libChunk = parseBlock(libLua, {});
      const libSf = LuaStackFrame.createWithGlobalEnv(env, libChunk.ctx);
      await evalStatement(libChunk, env, libSf);
    }
  }

  const sf = LuaStackFrame.createWithGlobalEnv(env, chunk.ctx);

  try {
    await evalStatement(chunk, env, sf);
  } catch (e: any) {
    if (e instanceof LuaRuntimeError) {
      console.error(`Error evaluating script:`, e.toPrettyString(luaFile));
    } else {
      console.error(`Error evaluating script:`, e);
    }
    expect(false).toBeTruthy();
  }
}
