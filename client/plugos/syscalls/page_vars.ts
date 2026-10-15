import { luaField } from "../../space_lua/fragment.ts";
import {
  planPageVarEdit,
  type TextEdit,
} from "../../space_lua/page_var_edit.ts";
import type { Client } from "../../client.ts";
import type { SysCallMapping } from "../system.ts";
import {
  type PageScope,
  pageScopeChangedEvent,
  type PageScopes,
} from "../../space_lua/page_scope.ts";
import {
  LuaBuiltinFunction,
  LuaMultiRes,
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
  // The proxy is empty: print and iterate the values behind it
  void mt.rawSet(
    "__tostring",
    new LuaBuiltinFunction({
      callback: () => values.toStringAsync(),
      description: "Shows a page scope's variables.",
    }),
  );
  void mt.rawSet(
    "__pairs",
    new LuaBuiltinFunction({
      callback: () => {
        const keys = values.keys();
        let i = 0;
        const iter = () =>
          i < keys.length
            ? new LuaMultiRes([keys[i], values.rawGet(keys[i++])])
            : undefined;
        return new LuaMultiRes([iter, proxy, null]);
      },
      description: "Iterates a page scope's variables.",
    }),
  );
  proxy.metatable = mt;
  return proxy;
}

export type PageVarsDeps = {
  // The open page, for code that runs outside any page (commands)
  currentPage: () => string | undefined;
  // Applies `plan`'s edit to `page`'s current text (nothing when it's null)
  editPage: (
    page: string,
    plan: (text: string) => TextEdit | null,
  ) => Promise<void>;
};

/** The page whose code is running, else the open page. */
function defaultPage(sf: LuaStackFrame | undefined, deps: PageVarsDeps) {
  const source = luaField(sf?.threadLocal.get("sourcePage"), "name");
  const page = typeof source === "string" ? source : deps.currentPage();
  if (!page) throw new Error("pageVars: no current page");
  return page;
}

export function pageVarsSyscalls(
  scopes: PageScopes,
  deps: PageVarsDeps,
): SysCallMapping {
  // `page`'s scope (the running page's by default), for the function `fn`
  const resolve = async (
    fn: string,
    sf: LuaStackFrame | undefined,
    page: string | undefined,
  ) => {
    page ??= defaultPage(sf, deps);
    const state = sf?.threadState;
    // Record before resolving, so a later fix to the page also refreshes us
    state?.track?.(pageScopeChangedEvent(page));
    const scope = await scopes.get(page, state?.pageScope, state?.track);
    if (scope?.firstError) {
      throw new Error(
        `${fn}: ${page} has failing definitions (${scope.firstError})`,
      );
    }
    return { scope, page };
  };
  const pageParameter = {
    name: "page",
    optional: true,
    description:
      "Page name; defaults to the page the running code is on, else the open page.",
  };
  return {
    "lua:pageVars.get": {
      callback: async (
        ctx: { sf?: LuaStackFrame },
        name: string,
        page?: string,
      ) => {
        const resolved = await resolve("pageVars.get", ctx.sf, page);
        const variables = resolved.scope?.env.variables;
        if (!variables?.has(name)) {
          throw new Error(
            `pageVars.get: ${resolved.page} has no variable "${name}"`,
          );
        }
        return variables.get(name) ?? null;
      },
      description:
        "Returns one variable a page defines with a `page-lua` block or a `${name = expr}` assignment. Errors when the page doesn't define it.",
      signatures: ["pageVars.get(name, page?)"],
      parameters: [
        { name: "name", description: "Variable name." },
        pageParameter,
      ],
      examples: [
        { code: 'pageVars.get("salary", "Budget")' },
        { code: 'pageVars.get("rate")' },
      ],
    },
    "lua:pageVars.all": {
      callback: async (ctx: { sf?: LuaStackFrame }, page?: string) => {
        const resolved = await resolve("pageVars.all", ctx.sf, page);
        return pageVarsTable(resolved.scope, resolved.page);
      },
      description:
        "Returns a read-only table of all variables a page defines with `page-lua` blocks and `${name = expr}` assignments.",
      signatures: ["pageVars.all(page?)"],
      parameters: [pageParameter],
      examples: [
        { code: 'pageVars.all("Budget")' },
        {
          code: "for name, value in pairs(pageVars.all()) do print(name, value) end",
        },
      ],
    },
    "lua:pageVars.set": {
      callback: async (
        ctx: { sf?: LuaStackFrame },
        name: string,
        value: unknown,
        page?: string,
      ) => {
        page ??= defaultPage(ctx.sf, deps);
        const target = page;
        await deps.editPage(target, (text) =>
          planPageVarEdit(text, target, name, value),
        );
      },
      description:
        "Sets a page variable by rewriting its `${name = value}` cell in the page text. Only cells holding a plain value (number, string, boolean, nil, or a table of these) can be set.",
      signatures: ["pageVars.set(name, value, page?)"],
      parameters: [
        { name: "name", description: "Variable name." },
        {
          name: "value",
          description: "A number, string, boolean, nil, or a table of these.",
        },
        {
          name: "page",
          optional: true,
          description:
            "Page name; defaults to the page the running code is on, else the open page.",
        },
      ],
      examples: [
        { code: 'pageVars.set("rate", 0.2)' },
        { code: 'pageVars.set("salary", 600, "Budget")' },
        {
          code: 'pageVars.set("todos", { { title = "Book venue", done = false } })',
        },
      ],
    },
  };
}

/**
 * Page edits for `pageVars.set`. The open page is edited in the editor (one
 * undoable step, cursor and unsaved typing kept) and saved right away, so
 * its scope and readers update without waiting for autosave. Any other page
 * is read, edited and written, re-planned once if it changed meanwhile.
 */
export function clientPageVarsDeps(client: Client): PageVarsDeps {
  return {
    currentPage: () => client.currentName() || undefined,
    editPage: async (page, plan) => {
      if (client.bootConfig.readOnly) {
        throw new Error("pageVars.set: this space is read-only");
      }
      const readOnlyPage = () =>
        new Error(`pageVars.set: ${page} is read-only`);
      if (
        page === client.currentName() &&
        !client.contentManager.isDocumentEditor()
      ) {
        if (client.currentPageMeta()?.perm === "ro") throw readOnlyPage();
        const view = client.editorView;
        const edit = plan(view.state.doc.toString());
        if (!edit) return;
        view.dispatch({ changes: edit });
        await client.save(true);
        return;
      }
      const read = async () => {
        try {
          return await client.space.readPage(page);
        } catch {
          throw new Error(`pageVars.set: page ${page} not found`);
        }
      };
      for (let attempt = 0; ; attempt++) {
        const { text, meta } = await read();
        if (meta?.perm === "ro") throw readOnlyPage();
        const edit = plan(text);
        if (!edit) return;
        const updated =
          text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        if (attempt === 0 && (await read()).text !== text) continue;
        await client.space.writePage(page, updated);
        return;
      }
    },
  };
}
