import { Config } from "./config.ts";
import { configSyscalls } from "./plugos/syscalls/config.ts";
import { editorSyscalls } from "./plugos/syscalls/editor.ts";
import { jsonschemaSyscalls } from "./plugos/syscalls/jsonschema.ts";
import { languageSyscalls } from "./plugos/syscalls/language.ts";
import { markdownSyscalls } from "./plugos/syscalls/markdown.ts";
import { systemSyscalls } from "./plugos/syscalls/system.ts";
import { System } from "./plugos/system.ts";
import { BUSY_LIMIT_DEFAULT_MS, makeLuaBudget } from "./space_lua/budget.ts";
import { evalStatement } from "./space_lua/eval.ts";
import { parseBlock } from "./space_lua/parse.ts";
import { LuaEnv, LuaStackFrame } from "./space_lua/runtime.ts";
import { luaBuildStandardEnv } from "./space_lua/stdlib.ts";
import { exposeSyscalls } from "./space_lua_api.ts";
import type { ToolBlock } from "./tooling.ts";

/**
 * Runs the boot blocks, each on its own, in a contained environment (only
 * exposing config.* calls) to build up a config object
 */
export async function loadConfig(
  blocks: Pick<ToolBlock, "ref" | "code">[],
  lateBoundClient: any,
  readOnly: boolean,
): Promise<Config> {
  const config = new Config();

  const rootEnv = luaBuildStandardEnv();

  // This is a system only used for the boot sequence, will be replaced later
  const bootSystem = new System<any>();
  // Only expose a limited set of syscalls that we can offer at this point
  bootSystem.registerSyscalls(
    [],
    systemSyscalls(lateBoundClient, readOnly),
    configSyscalls(config),
    // This offers calls like isMobile() which will be useful, and late binding for e.g. to make actionButtons run() work immediately on boot
    editorSyscalls(lateBoundClient),
    markdownSyscalls(lateBoundClient),
    languageSyscalls(),
    jsonschemaSyscalls(),
  );

  exposeSyscalls(rootEnv, bootSystem);

  // Each block is its own chunk, like in the full script load, so a block that
  // fails to parse cannot take the others down with it.
  for (const { ref, code } of blocks) {
    let chunk: ReturnType<typeof parseBlock>;
    try {
      chunk = parseBlock(code, {});
    } catch (e: any) {
      console.error(
        `Skipping boot block ${ref}, it failed to parse:`,
        e.message,
      );
      continue;
    }
    const sf = LuaStackFrame.createWithGlobalEnv(rootEnv, chunk.ctx);
    const localEnv = new LuaEnv(rootEnv);
    for (const statement of chunk.statements) {
      sf.threadState.budget = makeLuaBudget({
        busyLimitMs: BUSY_LIMIT_DEFAULT_MS,
        // No UI exists yet, so there is nothing to repaint: never yield, just stop.
        yieldAfterMs: Infinity,
        onLimit: (b) => {
          b.stopped = true;
        },
      });
      try {
        await evalStatement(statement, localEnv, sf);
      } catch (e: any) {
        // Since people may do whatever in their Lua code, we're going to be extremely liberal in ignoring errors
        // Primarily config.* calls are processed, the rest is implicitly ignored through failure
        console.info(
          "Statement errored out during boot, but ignoring:",
          code.slice(statement.ctx.from, statement.ctx.to),
          "Error:",
          e.message,
        );
      }
    }
  }
  return config;
}
