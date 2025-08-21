import type { System } from "../lib/plugos/system.ts";
import type { ScriptObject } from "../plugs/index/script.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
} from "../lib/space_lua/runtime.ts";
import {
  parse as parseLua,
  parseExpressionString,
} from "../lib/space_lua/parse.ts";
import { evalStatement } from "../lib/space_lua/eval.ts";
import {
  encodeRef,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { ASTCtx } from "../lib/space_lua/ast.ts";
import { buildLuaEnv } from "./space_lua_api.ts";
import type { LuaCollectionQuery } from "../lib/space_lua/query_collection.ts";

export class SpaceLuaEnvironment {
  env: LuaEnv = new LuaEnv();

  /**
   * Loads all Lua scripts from the database and evaluates them in a new environment
   * @param system
   */
  async reload(
    system: System<any>,
  ) {
    const allScripts: ScriptObject[] = await system.invokeFunction(
      "index.queryLuaObjects",
      ["space-lua", {
        objectVariable: "script",
        orderBy: [{
          expr: parseExpressionString("script.priority"),
          desc: true,
        }],
      } as LuaCollectionQuery],
    );
    try {
      this.env = buildLuaEnv(system);
      const tl = new LuaEnv();
      tl.setLocal("_GLOBAL", this.env);
      for (const script of allScripts) {
        try {
          console.log("Now evaluating", script.ref);
          const ast = parseLua(script.script, { ref: script.ref });
          // We create a local scope for each script
          const scriptEnv = new LuaEnv(this.env);
          const sf = new LuaStackFrame(tl, ast.ctx);
          await evalStatement(ast, scriptEnv, sf);
        } catch (e: any) {
          if (e instanceof LuaRuntimeError) {
            const origin = resolveASTReference(e.sf.astCtx!);
            if (origin) {
              console.error(
                `Error evaluating script: ${e.message} at [[${
                  encodeRef(origin)
                }]]`,
              );
              continue;
            }
          }
          console.error(
            `Error evaluating script: ${e.message} for script: ${script.script}`,
          );
        }
      }

      console.log("[Lua] Loaded", allScripts.length, "scripts");
    } catch (e: any) {
      console.error("Error reloading Lua scripts:", e.message);
    }
  }
}

export function resolveASTReference(ctx?: ASTCtx): Ref | null {
  if (!ctx?.ref) {
    return null;
  }
  const ref = parseToRef(ctx.ref);
  if (!ref) {
    return null;
  }

  if (ref.details?.type === "position") {
    ref.details.pos = (ref.details.pos as number) +
      "```space-lua\n".length +
      ctx.from!;
  }

  return ref;
}
