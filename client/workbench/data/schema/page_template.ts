/**
 * A page template made from a tag's schema: new pages start with the tag
 * and its attributes, left empty.
 */
import type { JsonSchema } from "../../../config_management/schema_lua.ts";

export function defaultTemplateName(tag: string): string {
  return `Library/Page Templates/${tag}`;
}

/** Bare where YAML reads it as the same string, else double-quoted */
function yamlString(s: string): string {
  const bare =
    /^[\p{L}\p{N}_][\p{L}\p{N}_\-./]*$/u.test(s) &&
    !/^([\d.+-]+|true|false|null|yes|no|on|off)$/i.test(s);
  return bare ? s : JSON.stringify(s);
}

export function pageTemplateText(tag: string, schema: JsonSchema): string {
  const lines = [
    `tags: ${yamlString(tag)}`,
    ...Object.keys(schema.properties ?? {}).map(
      (name) => `${yamlString(name)}:`,
    ),
  ];
  return [
    "---",
    "tags: meta/template/page",
    "frontmatter: |",
    ...lines.map((l) => `  ${l}`),
    "---",
    "",
  ].join("\n");
}
