import YAML from "js-yaml";
import {
  findNodeOfType,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";

export type Definition =
  | { kind: "block"; index: number; source: string }
  | { kind: "assign"; name: string; exprSource: string };

export type ExtractedDefinitions = {
  definitions: Definition[];
  duplicateNames: Set<string>;
  fingerprint: string;
  frontmatter: Record<string, unknown>;
};

/** Whether a frontmatter or hashtag node marks its page as a template. */
export function marksTemplate(nodeType: string, text: string): boolean {
  if (nodeType === "FrontMatterCode")
    return /tags:.*meta\/template/s.test(text);
  if (nodeType === "Hashtag") return text.startsWith("#meta/template");
  return false;
}

function parseFrontmatter(yaml: string): Record<string, unknown> {
  try {
    const parsed = YAML.load(yaml);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function extractDefinitions(text: string): ExtractedDefinitions {
  const tree = parse(extendedMarkdownLanguage, text);
  const definitions: Definition[] = [];
  const seen = new Set<string>();
  const duplicateNames = new Set<string>();
  let frontmatter: Record<string, unknown> = {};
  let isTemplate = false;
  let blockIndex = 0;

  traverseTree(tree, (node) => {
    if (node.type === "FrontMatterCode" || node.type === "Hashtag") {
      const nodeText = renderToText(node);
      if (marksTemplate(node.type, nodeText)) isTemplate = true;
      if (node.type === "FrontMatterCode")
        frontmatter = parseFrontmatter(nodeText);
      return true;
    }
    if (node.type === "FencedCode") {
      const info = findNodeOfType(node, "CodeInfo");
      if (info && renderToText(info).trim() === "page-lua") {
        const code = findNodeOfType(node, "CodeText");
        definitions.push({
          kind: "block",
          index: blockIndex++,
          source: code ? renderToText(code) : "",
        });
      }
      // Never look for directives inside code
      return true;
    }
    if (node.type === "LuaDirective") {
      const body = findNodeOfType(node, "LuaExpressionDirective");
      const nameNode = body && findNodeOfType(body, "LuaAssignmentName");
      if (body && nameNode) {
        const name = renderToText(nameNode);
        const bodyText = renderToText(body);
        if (seen.has(name)) duplicateNames.add(name);
        seen.add(name);
        definitions.push({
          kind: "assign",
          name,
          exprSource: bodyText.slice(bodyText.indexOf("=") + 1),
        });
      }
      return true;
    }
    return false;
  });

  // Templates define nothing: their directives belong to the pages they make
  if (isTemplate || definitions.length === 0) {
    return {
      definitions: [],
      duplicateNames: new Set(),
      fingerprint: "",
      frontmatter,
    };
  }
  return {
    definitions,
    duplicateNames,
    fingerprint: JSON.stringify(definitions),
    frontmatter,
  };
}
