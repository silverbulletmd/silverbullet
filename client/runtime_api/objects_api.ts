import {
  translateListRequest,
  TranslationError,
  type Filter,
  type OrderKey,
} from "./translate_query.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import type { LuaExpression } from "../space_lua/ast.ts";
import {
  type LuaEnv,
  type LuaStackFrame,
  luaValueToJS,
} from "../space_lua/runtime.ts";

export type ObjectsRequest =
  | { kind: "list_tags" }
  | { kind: "get"; tag: string; ref: string }
  | {
      kind: "list";
      tag: string;
      filters: Filter[];
      order: OrderKey[];
      limit: number;
      offset: number;
      select?: string[];
      debug?: boolean;
    };

export type ObjectsResponse =
  | { ok: true; items: any[]; equivalentLua?: string }
  | { ok: true; item: any }
  | { ok: false; code: string; error: string };

export type ObjectsDeps = {
  objectIndex: {
    queryLuaObjects(env: LuaEnv, tag: string, query: any): Promise<any[]>;
    tagNames(): Promise<string[]>;
  };
  env: LuaEnv;
  stackFrame: LuaStackFrame;
};

export async function handleObjectsRequest(
  deps: ObjectsDeps,
  req: ObjectsRequest,
): Promise<ObjectsResponse> {
  try {
    switch (req.kind) {
      case "list_tags": {
        const items = await deps.objectIndex.tagNames();
        return { ok: true, items };
      }
      case "get": {
        const items = await deps.objectIndex.queryLuaObjects(
          deps.env,
          req.tag,
          {
            objectVariable: "_it",
            where: parseExpressionString(
              `_it.ref == ${JSON.stringify(req.ref)}`,
            ) as LuaExpression,
            limit: 1,
          },
        );
        if (items.length === 0) {
          return {
            ok: false,
            code: "not_found",
            error: `${req.tag}/${req.ref} not found`,
          };
        }
        return { ok: true, item: items[0] };
      }
      case "list": {
        const { query, equivalentLua } = translateListRequest(req);
        const rawItems = await deps.objectIndex.queryLuaObjects(
          deps.env,
          req.tag,
          query,
        );
        const items = req.select?.length
          ? await Promise.all(
              rawItems.map((v) => luaValueToJS(v, deps.stackFrame)),
            )
          : rawItems;
        return { ok: true, items, equivalentLua };
      }
    }
  } catch (e: unknown) {
    if (e instanceof TranslationError) {
      return { ok: false, code: e.code, error: e.cause };
    }
    return {
      ok: false,
      code: "internal_error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
