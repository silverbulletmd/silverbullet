import type {
  LuaFunctionInfo,
  LuaPropertyInspection,
} from "@silverbulletmd/silverbullet/type/index";
import type { DocumentedCompletion } from "../codemirror/editing/completion_info.ts";
import { renderApiDocumentationMarkdown } from "./api_documentation.ts";

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

export function luaAccessAt(
  linePrefix: string,
): { parts: string[]; prefix: string } | null {
  const access = /((?:[a-zA-Z_0-9]+\.)*[a-zA-Z_0-9]*)$/.exec(linePrefix)?.[1];
  if (!access) return null;
  const parts = access.split(".");
  const prefix = parts.pop() ?? "";
  if (LUA_KEYWORDS.has(prefix)) return null;
  return { parts, prefix };
}

export function luaCompletionOptions(
  candidates: LuaPropertyInspection[],
  parts: string[],
  prefix: string,
): DocumentedCompletion[] {
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
      options.push({ label: candidate.key, detail: candidate.type });
    }
  }
  return options;
}
