import { expect, test } from "vitest";
import { parse } from "./parse.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame } from "./runtime.ts";
import { evalStatement } from "./eval.ts";
import { readFile, } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, } from "node:path";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const testFiles = readdirSync(__dirname, { recursive: true })
  .filter((f): f is string => typeof f === "string" && f.endsWith("_test.lua"))
  .sort();

for (const file of testFiles) {
  test(`[Lua] ${file}`, async () => {
    await runLuaTest(`./${file}`);
  });
}

async function runLuaTest(luaPath: string) {
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

  const luaFile = await readFile(
    fileURLToPath(new URL(luaPath, import.meta.url)),
    "utf-8",
  );
  const chunk = parse(luaFile, {});
  const env = new LuaEnv(luaBuildStandardEnv());
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
