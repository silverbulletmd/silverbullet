import type { SysCallMapping } from "../system.ts";
import type { PageScope, PageScopes } from "../../space_lua/page_scope.ts";
import {
  LuaBuiltinFunction,
  LuaRuntimeError,
  type LuaStackFrame,
  LuaTable,
} from "../../space_lua/runtime.ts";

export function pageVarsTable(scope: PageScope | null, page: string): LuaTable {
  const values = new LuaTable();
  for (const [name, value] of scope?.env.variables ?? []) {
    void values.rawSet(name, value);
  }
  // __newindex only fires for absent keys, so the proxy itself stays empty
  const proxy = new LuaTable();
  const mt = new LuaTable();
  void mt.rawSet("__index", values);
  void mt.rawSet(
    "__newindex",
    new LuaBuiltinFunction({
      callback: (sf: LuaStackFrame) => {
        throw new LuaRuntimeError(`page scope of ${page} is read-only`, sf);
      },
      description: "Rejects writes to a page scope.",
    }),
  );
  proxy.metatable = mt;
  return proxy;
}

export function pageVarsSyscalls(scopes: PageScopes): SysCallMapping {
  return {
    "lua:space.pageVars": {
      callback: async (ctx: { sf?: LuaStackFrame }, page: string) => {
        const frame = ctx.sf?.threadState.pageScope;
        // Record before resolving, so a later fix to the page also refreshes us
        frame?.onRead?.(page);
        const scope = await scopes.get(page, frame);
        if (scope?.firstError) {
          throw new Error(
            `space.pageVars: ${page} has failing definitions (${scope.firstError})`,
          );
        }
        return pageVarsTable(scope, page);
      },
      description:
        "Returns a read-only table of the variables a page defines with `page-lua` blocks and `${name = expr}` assignments.",
      signatures: ["space.pageVars(page)"],
      parameters: [{ name: "page", description: "Page name." }],
      examples: [{ code: 'space.pageVars("Budget").salary' }],
    },
  };
}
