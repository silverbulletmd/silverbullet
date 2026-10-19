/**
 * The list templates a query can select with: whatever `templates.*` holds
 * in the running space, described by the `---` doc comments above each one,
 * whose `@param` type names the objects it takes:
 *
 *     --- Renders a task with its checkbox.
 *     --- @param t task
 *     templates.taskItem = template.new[==[…]==]
 */

import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import type { LuaFunctionDocumentation } from "../../plug-api/types/index.ts";
import type { Client } from "../client.ts";
import type { LuaExpression } from "../space_lua/ast.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { LuaTable } from "../space_lua/runtime.ts";
import { blockSourceRef } from "./blocks.ts";

export type QueryTemplate = {
  /** As written in a query: `templates.taskItem` */
  id: string;
  name: string;
  description?: string;
  /** The tags of the objects it takes, from its `@param` type (`page|task`) */
  types: string[];
  /** Where a script assigns it */
  definition?: Ref;
};

/** `templates.x` or `templates["x"]`: the name it assigns, if it is one */
function templateName(target: LuaExpression): string | null {
  if (
    target.type === "PropertyAccess" &&
    target.object.type === "Variable" &&
    target.object.name === "templates"
  ) {
    return target.property;
  }
  if (
    target.type === "TableAccess" &&
    target.object.type === "Variable" &&
    target.object.name === "templates" &&
    target.key.type === "String"
  ) {
    return target.key.value;
  }
  return null;
}

/** Where a template is assigned, and the doc comments above it */
export type TemplateDefinition = {
  doc?: LuaFunctionDocumentation;
  ref: Ref | null;
};

/**
 * The templates the scripts assign at their top level, by name; a later
 * script's assignment wins, as it does when they run
 */
export function templateDefinitions(
  scripts: { ref: string; source: string }[],
): Map<string, TemplateDefinition> {
  const defs = new Map<string, TemplateDefinition>();
  for (const script of scripts) {
    let statements;
    try {
      statements = parseBlock(script.source).statements;
    } catch {
      // A script that doesn't parse defines no templates either
      continue;
    }
    const block = blockSourceRef(script.ref, "space-lua");
    for (const s of statements) {
      if (s.type !== "Assignment" || s.variables.length !== 1) continue;
      const name = templateName(s.variables[0]);
      if (!name) continue;
      const ref =
        block?.details?.type === "position"
          ? {
              ...block,
              details: {
                type: "position" as const,
                pos: block.details.pos + (s.ctx.from ?? 0),
              },
            }
          : block;
      defs.set(name, {
        ...(s.documentation ? { doc: s.documentation } : {}),
        ref,
      });
    }
  }
  return defs;
}

/** The templates named, with what their definitions say, by name */
export function templateList(
  names: string[],
  defs: Map<string, TemplateDefinition>,
): QueryTemplate[] {
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const def = defs.get(name);
      const type = def?.doc?.parameters?.[0]?.type;
      return {
        id: `templates.${name}`,
        name,
        ...(def?.doc?.description ? { description: def.doc.description } : {}),
        types: type ? type.split("|").map((t) => t.trim()) : [],
        ...(def?.ref ? { definition: def.ref } : {}),
      };
    });
}

/** `list` with the templates that take `tag`'s objects first */
export function templatesFor(
  list: QueryTemplate[],
  tag: string,
): QueryTemplate[] {
  const fits = (t: QueryTemplate) => (t.types.includes(tag) ? 0 : 1);
  return list
    .map((t, i) => [t, i] as const)
    .sort(([a, i], [b, j]) => fits(a) - fits(b) || i - j)
    .map(([t]) => t);
}

// Worked out once per load of the space's scripts, which is what defines them
const loaded = new WeakMap<object, QueryTemplate[]>();

/** The templates the running space defines */
export function loadTemplates(client: Client): QueryTemplate[] {
  const lua = client.clientSystem.spaceLuaEnv;
  const load = lua.lastLoad;
  const cached = load && loaded.get(load);
  if (cached) return cached;
  const table = lua.env.get("templates");
  if (!(table instanceof LuaTable)) return [];
  const names = table.keys().filter((k): k is string => typeof k === "string");
  const list = templateList(names, templateDefinitions(load?.scripts ?? []));
  if (load) loaded.set(load, list);
  return list;
}
