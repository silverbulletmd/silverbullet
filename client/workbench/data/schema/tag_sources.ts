/** Where tag schemas are defined: the space-lua scripts that call `tag.define` with a schema. */
import { SCHEMAS_MARKER } from "../../../config_management/config_block.ts";
import {
  type ScannedStatement,
  scanStatements,
} from "../../../config_management/managed_lua.ts";

export type TagSource = { ref: string; page: string };

/**
 * For each tag, the scripts whose top-level `tag.define { name = "…", schema = … }`
 * gives it a schema. The Workbench's own schemas block doesn't count.
 */
export function schemaSources(
  scripts: { ref: string; page: string; script: string }[],
): Record<string, TagSource[]> {
  const result: Record<string, TagSource[]> = {};
  for (const { ref, page, script } of scripts) {
    if (script.includes(SCHEMAS_MARKER)) continue;
    let statements: ScannedStatement[];
    try {
      statements = scanStatements(script);
    } catch {
      continue;
    }
    for (const st of statements) {
      if (st.kind !== "define" || !st.schemaRange) continue;
      // Indexed scripts carry their page only in the ref (`Page@pos`)
      (result[st.tag] ??= []).push({
        ref,
        page: page ?? ref.replace(/@\d+$/, ""),
      });
    }
  }
  return result;
}
