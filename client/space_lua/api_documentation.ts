import type {
  LuaFunctionExampleDocumentation,
  LuaFunctionInfo,
  LuaFunctionParameterDocumentation,
  LuaFunctionReturnDocumentation,
} from "../../plug-api/types/index.ts";

function compareNames(a: LuaFunctionInfo, b: LuaFunctionInfo): number {
  const aName = a.name ?? "";
  const bName = b.name ?? "";
  return aName < bName ? -1 : aName > bName ? 1 : 0;
}

function signature(info: LuaFunctionInfo): string {
  const parameters = (info.parameters ?? [])
    .map((parameter) => `${parameter.name}${parameter.optional ? "?" : ""}`)
    .join(", ");
  return `${info.name ?? "<anonymous>"}(${parameters})`;
}

function renderParameter(parameter: LuaFunctionParameterDocumentation): string {
  const type = parameter.type ? ` (\`${parameter.type}\`)` : "";
  const description = parameter.description
    ? ` — ${parameter.description}`
    : "";
  return `- \`${parameter.name}${parameter.optional ? "?" : ""}\`${type}${description}`;
}

function renderReturn(value: LuaFunctionReturnDocumentation): string {
  const type = value.type ? `\`${value.type}\`` : "Value";
  return `- ${type}${value.description ? ` — ${value.description}` : ""}`;
}

function codeFence(example: LuaFunctionExampleDocumentation): string[] {
  const longestFence = Math.max(
    2,
    ...[...example.code.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(longestFence + 1);
  return [`${fence}${example.language ?? "lua"}`, example.code, fence];
}

function renderFunction(
  info: LuaFunctionInfo,
  apiNamespace?: string,
): string[] {
  const lines = [`### \`${info.name ?? "<anonymous>"}\``, ""];
  const signatures = info.signatures?.length
    ? info.signatures
    : [signature(info)];
  for (const value of signatures) lines.push(`\`${value}\``);

  if (info.deprecated) {
    lines.push(
      "",
      `> **Deprecated:** ${
        typeof info.deprecated === "string"
          ? info.deprecated
          : "This function is deprecated."
      }`,
    );
  }
  if (info.description) lines.push("", info.description);
  if (info.parameters?.length) {
    lines.push("", "**Parameters:**", "");
    lines.push(...info.parameters.map(renderParameter));
  }
  if (info.returns?.length) {
    lines.push("", "**Returns:**", "");
    lines.push(...info.returns.map(renderReturn));
  }
  if (info.examples?.length) {
    lines.push(
      "",
      info.examples.length === 1 ? "**Example:**" : "**Examples:**",
    );
    for (const example of info.examples) {
      if (example.description) lines.push("", example.description);
      lines.push("", ...codeFence(example));
    }
  }
  const namespacePage = apiNamespace ? `API/${apiNamespace}` : undefined;
  if (info.see && info.see !== namespacePage) {
    lines.push("", `**See:** [[${info.see}]]`);
  }
  return lines;
}

/** Render function metadata as deterministic Markdown for live `${...}` directives. */
export function renderApiDocumentationMarkdown(
  functions: LuaFunctionInfo[],
  context?: string,
): string {
  const documented = functions.filter((info) => info.name).sort(compareNames);
  if (documented.length === 0) {
    return context
      ? `_No documented API functions found for \`${context}\`._`
      : "_No functions found._";
  }
  return documented
    .flatMap((info, index) => [
      ...(index > 0 ? [""] : []),
      ...renderFunction(info, context),
    ])
    .join("\n")
    .trim();
}
