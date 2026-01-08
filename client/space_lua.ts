import type { System } from "./plugos/system.ts";
import type { SpaceLuaObject } from "../plugs/index/space_lua.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame } from "./space_lua/runtime.ts";
import { parse as parseLua, parseExpressionString } from "./space_lua/parse.ts";
import { evalStatement } from "./space_lua/eval.ts";
import {
  encodeRef,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { ASTCtx } from "./space_lua/ast.ts";
import { buildLuaEnv } from "./space_lua_api.ts";
import type { LuaCollectionQuery } from "./space_lua/query_collection.ts";

export class SpaceLuaEnvironment {
  env: LuaEnv;

  constructor(private system: System<any>) {
    this.env = buildLuaEnv(system);
  }

  /**
   * Loads all Lua scripts from the database and evaluates them in a new environment
   * @param system
   */
  async reload() {
    const allScripts: SpaceLuaObject[] = await this.system.invokeFunction(
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
      this.env = buildLuaEnv(this.system);
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
            e,
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
