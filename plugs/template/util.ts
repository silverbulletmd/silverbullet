import type { PageMeta } from "../../plug-api/types.ts";
import { space, system, template } from "@silverbulletmd/silverbullet/syscalls";
import { cleanTemplate } from "./plug_api.ts";
import { LuaTable, luaToString } from "$common/space_lua/runtime.ts";

export function defaultTransformer(v: any): Promise<string> {
  if (v === undefined) {
    return Promise.resolve("");
  }
  if (typeof v === "string") {
    return Promise.resolve(escapeRegularPipes(v.replaceAll("\n", " ")));
  }
  if (v && typeof v === "object") {
    return Promise.resolve(luaToString(v));
  }
  return Promise.resolve("" + v);
}

/**
 * Escapes all pipes that would inadvertently delimit a markdown table column.
 * Does not escape columns that are used for aliasing in WikiLinks or Commands:
 * `[[WikiLink|Alias]]` and `{[Command: Name|Click Me!]("args")}`
 * @param s The text to replace
 * @returns The text where the pipes outside of silverbullet specific context is
 *  replaced with an escaped pipe.
 */
function escapeRegularPipes(s: string) {
  let result = "";
  let isInWikiLink = false;
  let isInCommandButton = false;

  for (let i = 0; i < s.length; i++) {
    if (s[i] == "[" && s[i + 1] == "[") {
      isInWikiLink = true;
    } else if (s[i] == "]" && s[i + 1] == "]" && isInWikiLink) {
      isInWikiLink = false;
    }
    if (s[i] == "{" && s[i + 1] == "[") {
      isInCommandButton = true;
    } else if (
      (s[i] == "]" || s[i] == ")") && s[i + 1] == "}" && isInCommandButton
    ) {
      isInCommandButton = false;
    } else if (s[i] == "|" && !isInWikiLink && !isInCommandButton) {
      result += "\\";
    }

    result += s[i];
  }

  return result;
}

// Nicely format an array of JSON objects as a Markdown table
export async function jsonToMDTable(
  jsonArray: any[],
  valueTransformer: (v: any) => Promise<string> = defaultTransformer,
): Promise<string> {
  const headers = new Set<string>();
  for (const entry of jsonArray) {
    for (const k of Object.keys(entry)) {
      headers.add(k);
    }
  }

  const headerList = [...headers];
  const lines = [];
  lines.push(
    "|" +
      headerList
        .map(
          (headerName) => headerName,
        )
        .join("|") +
      "|",
  );
  lines.push(
    "|" +
      headerList
        .map(() => "--")
        .join("|") +
      "|",
  );
  for (const val of jsonArray) {
    const el = [];
    for (const prop of headerList) {
      const s = await valueTransformer(val[prop]);
      el.push(s);
    }
    lines.push("|" + el.join("|") + "|");
  }
  return lines.join("\n");
}

export async function renderQueryTemplate(
  pageMeta: PageMeta,
  templatePage: string,
  data: any[],
  renderAll: boolean,
): Promise<string> {
  const config = await system.getSpaceConfig();
  let templateText = await space.readPage(templatePage);
  templateText = await cleanTemplate(templateText);

  if (!renderAll) {
    templateText = `{{#each .}}\n${templateText}\n{{/each}}`;
  }
  return template.renderTemplate(templateText, data, {
    page: pageMeta,
    config,
  });
}

export function renderExpressionResult(result: any): Promise<string> {
  if (result instanceof LuaTable) {
    result = result.toJS();
  }
  if (
    Array.isArray(result) && result.length > 0 && typeof result[0] === "object"
  ) {
    // If result is an array of objects, render as a markdown table
    try {
      return jsonToMDTable(result);
    } catch (e: any) {
      console.error(
        `Error rendering expression directive: ${e.message} for value ${
          JSON.stringify(result)
        }`,
      );
      return Promise.resolve(JSON.stringify(result));
    }
  } else if (typeof result === "object" && result.constructor === Object) {
    // if result is a plain object, render as a markdown table
    return jsonToMDTable([result]);
  } else if (Array.isArray(result)) {
    // Not-object array, let's render it as a markdown list
    return Promise.resolve(result.map((item) => `- ${item}`).join("\n"));
  } else {
    return Promise.resolve("" + result);
  }
}
