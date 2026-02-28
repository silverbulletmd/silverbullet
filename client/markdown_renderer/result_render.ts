import {
  renderExpressionResult,
  defaultTransformer,
  refCellTransformer,
  jsonToMDTable,
} from "../space_lua/render_lua_markdown.ts";

export {
  renderSBExpressionResult as renderExpressionResult,
  defaultTransformer,
  refCellTransformer,
  jsonToMDTable
};

/**
 * Applies some heuristics to figure out if a string should be rendered as a markdown block or inline markdown
 * @param s markdown string
 */
export function isBlockMarkdown(s: string) {
  if (s.includes("\n")) {
    return true;
  }
  // If it contains something resembling a list
  return !!s.match(/[\-\*]\s+/);
}

// The entrypoint signature is preserved for compatibility
export function renderSBExpressionResult(result: any): Promise<string> {
  return renderExpressionResult(result, defaultTransformer);
}
