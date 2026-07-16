import type { Completion, CompletionResult } from "@codemirror/autocomplete";
import { config, editor, lua } from "@silverbulletmd/silverbullet/syscalls";
import type {
  CompleteEvent,
  EnrichedClickEvent,
} from "@silverbulletmd/silverbullet/type/client";
import type {
  LuaFunctionInfo,
  LuaPropertyInspection,
} from "@silverbulletmd/silverbullet/type/index";
import { renderApiDocumentationMarkdown } from "../../client/space_lua/api_documentation.ts";

const LUA_KEYWORDS = new Set([
  "do",
  "if",
  "then",
  "for",
  "else",
  "end",
  "function",
  "local",
  "return",
  "in",
]);

const LINK_NODES = new Set([
  "WikiLink",
  "Link",
  "Image",
  "Autolink",
  "NakedURL",
  "Hashtag",
  "FootnoteRef",
]);

type DocumentedCompletion = Completion & {
  documentation?: string;
  snippet?: string;
};

function luaCodeFromParents(parentNodes?: string[]): string | null {
  for (const parent of parentNodes ?? []) {
    const fencedPrefix = "FencedCode:space-lua";
    if (parent.startsWith(fencedPrefix)) {
      return parent.slice(fencedPrefix.length).replace(/^\n/, "");
    }
    const directivePrefix = "LuaDirective:";
    if (parent.startsWith(directivePrefix)) {
      return parent.slice(directivePrefix.length);
    }
  }
  return null;
}

function inLuaContext(parentNodes?: string[]): boolean {
  return (parentNodes ?? []).some(
    (parent) =>
      parent === "LuaDirective" ||
      parent.startsWith("LuaDirective:") ||
      parent.startsWith("FencedCode:space-lua"),
  );
}

function onLink(parentNodes?: string[]): boolean {
  return (parentNodes ?? []).some((parent) => LINK_NODES.has(parent));
}

function inComment(line: string): boolean {
  return line.includes("--");
}

function inString(line: string): boolean {
  let singleQuotes = 0;
  let doubleQuotes = 0;
  let brackets = 0;
  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === "'") {
      singleQuotes++;
    } else if (character === '"') {
      doubleQuotes++;
    } else if (
      character === "[" &&
      line[i + 1] === "[" &&
      line.slice(Math.max(0, i - 5), i + 1) !== "query["
    ) {
      brackets++;
    } else if (character === "]" && line[i - 1] === "]") {
      brackets--;
    }
  }
  return singleQuotes % 2 === 1 || doubleQuotes % 2 === 1 || brackets > 0;
}

function schemaToDummyValue(schema: any): unknown {
  switch (schema?.type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object": {
      const value: Record<string, unknown> = {};
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        value[key] = schemaToDummyValue(property);
      }
      return value;
    }
    default:
      return null;
  }
}

async function schemaLocals(luaCode: string): Promise<Record<string, unknown>> {
  const locals: Record<string, unknown> = {};
  const declarations =
    /(?:from|local)\s+(\w+)\s+=\s*(?:index\.objects\s*"(\w+)"|index\.objects\s*\("(\w+)"\)|tags\.(\w+))/g;
  for (const match of luaCode.matchAll(declarations)) {
    const tag = match[2] ?? match[3] ?? match[4];
    const schema = await config.get(["tags", tag, "schema"], null);
    if (schema) {
      locals[match[1]] = schemaToDummyValue(schema);
    }
  }
  return locals;
}

function luaType(value: unknown): string {
  if (value === null || value === undefined) return "nil";
  if (Array.isArray(value) || typeof value === "object") return "table";
  return typeof value;
}

function localProperties(value: unknown): LuaPropertyInspection[] {
  if (value === null || value === undefined || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).map(([key, child]) => ({
    key,
    type: luaType(child),
  }));
}

function inspectLocalPath(
  locals: Record<string, unknown>,
  path: string[],
): LuaPropertyInspection[] | null {
  if (path.length === 0) {
    return Object.entries(locals).map(([key, value]) => ({
      key,
      type: luaType(value),
    }));
  }
  if (!Object.hasOwn(locals, path[0])) return null;
  let value = locals[path[0]];
  for (const key of path.slice(1)) {
    if (
      value === null ||
      value === undefined ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    ) {
      return [];
    }
    value = (value as Record<string, unknown>)[key];
  }
  return localProperties(value);
}

function completionLabel(name: string, info?: LuaFunctionInfo): string {
  if (info?.parameters) {
    const parameters = info.parameters.map(
      (parameter) => `${parameter.name ?? "?"}${parameter.optional ? "?" : ""}`,
    );
    return `${name}(${parameters.join(", ")})`;
  }
  const signature = info?.signatures?.[0];
  const parameters = signature?.match(/\(([^)]*)\)/)?.[1];
  return `${name}(${parameters ?? ""})`;
}

function completionDetail(
  info: LuaFunctionInfo | undefined,
  fallback: string,
): string {
  return (
    info?.description
      ?.split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? fallback
  );
}

function functionDocumentation(
  info: LuaFunctionInfo,
  fallbackName: string,
): string {
  const documentedInfo = {
    ...info,
    name: info.name ?? fallbackName,
  };
  const separator = documentedInfo.name.lastIndexOf(".");
  const namespace =
    separator > 0 ? documentedInfo.name.slice(0, separator) : undefined;
  return renderApiDocumentationMarkdown([documentedInfo], namespace);
}

export async function luaComplete(
  event: CompleteEvent,
): Promise<CompletionResult | null> {
  const luaCode = luaCodeFromParents(event.parentNodes);
  if (
    luaCode === null ||
    inComment(event.linePrefix) ||
    inString(event.linePrefix)
  ) {
    return null;
  }

  const access = /((?:[a-zA-Z_0-9]+\.)*[a-zA-Z_0-9]*)$/.exec(
    event.linePrefix,
  )?.[1];
  if (!access) return null;
  const parts = access.split(".");
  const prefix = parts.pop() ?? "";
  if (LUA_KEYWORDS.has(prefix)) return null;

  const locals = await schemaLocals(luaCode);
  const localCandidates = inspectLocalPath(locals, parts);
  let candidates: LuaPropertyInspection[];
  if (localCandidates !== null && parts.length > 0) {
    candidates = localCandidates;
  } else {
    const inspection = await lua.inspect(parts);
    candidates = inspection?.properties ?? [];
    if (parts.length === 0) {
      const merged = new Map(
        candidates.map((candidate) => [candidate.key, candidate]),
      );
      for (const candidate of localCandidates ?? []) {
        merged.set(candidate.key, candidate);
      }
      candidates = [...merged.values()];
    }
  }

  const options: DocumentedCompletion[] = [];
  for (const candidate of candidates) {
    if (!candidate.key.startsWith(prefix)) continue;
    if (candidate.type === "function") {
      const fullName = [...parts, candidate.key].join(".");
      const fallback =
        candidate.functionInfo?.kind === "lua" ? "function" : "built-in";
      options.push({
        label: completionLabel(candidate.key, candidate.functionInfo),
        snippet: `${candidate.key}(\${})`,
        detail: completionDetail(candidate.functionInfo, fallback),
        documentation: candidate.functionInfo
          ? functionDocumentation(candidate.functionInfo, fullName)
          : undefined,
      });
    } else {
      options.push({
        label: candidate.key,
        detail: candidate.type,
      });
    }
  }

  return options.length > 0
    ? {
        from: event.pos - prefix.length,
        options,
      }
    : null;
}

function symbolAt(text: string, position: number): string | null {
  let start = Math.min(Math.max(position, 0), text.length);
  while (start > 0 && /[a-zA-Z0-9._]/.test(text[start - 1])) start--;
  let end = Math.min(Math.max(position, 0), text.length);
  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) end++;
  const symbol = text.slice(start, end);
  return /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(symbol) ? symbol : null;
}

export async function luaNavigate(event: EnrichedClickEvent): Promise<void> {
  if (
    !(event.metaKey || event.ctrlKey) ||
    onLink(event.parentNodes) ||
    !inLuaContext(event.parentNodes)
  ) {
    return;
  }

  const symbol = symbolAt(await editor.getText(), event.pos);
  if (!symbol) return;
  const inspection = await lua.inspect(symbol.split("."));
  if (inspection?.definition) {
    await editor.navigate(inspection.definition);
    return;
  }
  await editor.flashNotification(
    "Cannot navigate to definition; not defined in Lua.",
  );
}
