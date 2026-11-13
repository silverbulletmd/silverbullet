import YAML from "js-yaml";
import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  traverseTree,
} from "./tree.ts";

export const TOOL_PAGE_PREFIX = "Library/";
export const CONFIG_PAGE_NAME = "Library/Config";

export function isToolPage(name: string): boolean {
  return name.startsWith(TOOL_PAGE_PREFIX);
}

export function toolPageLua(varName: string): string {
  return `string.startsWith(${varName}.name, "${TOOL_PAGE_PREFIX}")`;
}

export type ToolFence = "space-lua" | "space-style";

/** A `space-lua` or `space-style` fence on a page. */
export type FencedToolBlock = {
  fence: ToolFence;
  /** Start and end of the whole fence */
  from: number;
  to: number;
  /** Range of the code inside the fence */
  codeFrom: number;
  codeTo: number;
  code: string;
  /** From `-- priority: n` (Lua) or `/* priority: n *\/` (CSS); unset when absent */
  priority?: number;
};

const priorityPatterns: Record<ToolFence, RegExp> = {
  "space-lua": /--\s*priority:\s*(-?\d+)/,
  "space-style": /\/\*+\s*priority:\s*(-?\d+)/,
};

/**
 * Every `space-lua` and `space-style` fence in `tree`, in page order. Fences
 * inside a comment are left out: commenting a block out is how it gets
 * disabled. The one definition of a tool block, shared by boot, indexing and
 * lint.
 */
export function findToolBlocks(tree: ParseTree): FencedToolBlock[] {
  const blocks: FencedToolBlock[] = [];
  traverseTree(tree, (node) => {
    if (node.type === "CommentBlock") {
      return true;
    }
    if (node.type !== "FencedCode") {
      return false;
    }
    const fence = findNodeOfType(node, "CodeInfo")?.children?.[0]?.text;
    if (fence !== "space-lua" && fence !== "space-style") {
      return true;
    }
    const codeNode = findNodeOfType(node, "CodeText");
    const code = codeNode?.children?.[0]?.text;
    if (!codeNode || code === undefined) {
      return true;
    }
    const priority = code.match(priorityPatterns[fence])?.[1];
    blocks.push({
      fence,
      from: node.from!,
      to: node.to!,
      codeFrom: codeNode.from!,
      codeTo: codeNode.to!,
      code,
      ...(priority !== undefined ? { priority: +priority } : {}),
    });
    return true;
  });
  return blocks;
}

/**
 * Whether a `space-lua` block on `page` also runs in the restricted boot
 * pre-pass: every block on Library/Config, and blocks with a `-- boot: true` line.
 */
export function isBootScript(page: string, code: string): boolean {
  return page === CONFIG_PAGE_NAME || hasBootMarker(code);
}

/** The line that makes a `space-lua` block a boot block */
export const BOOT_MARKER = "-- boot: true";

export function hasBootMarker(code: string): boolean {
  return /^\s*--\s*boot:\s*true\s*$/m.test(code);
}

/** The page's frontmatter as an object; `{}` when absent or not valid YAML. */
export function findFrontmatter(tree: ParseTree): Record<string, unknown> {
  const node = findNodeOfType(tree, "FrontMatterCode");
  if (!node) {
    return {};
  }
  try {
    const parsed = YAML.load(renderToText(node));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
