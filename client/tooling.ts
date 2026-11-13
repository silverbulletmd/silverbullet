import {
  type ThemeInfo,
  themeInfoFromFrontmatter,
} from "@silverbulletmd/silverbullet/lib/themes";
import {
  findFrontmatter,
  findToolBlocks,
  isBootScript,
  isToolPage,
} from "@silverbulletmd/silverbullet/lib/tool_pages";
import { parseMarkdown } from "./markdown_parser/parser.ts";

export type ToolingFile = { path: string; lastModified: number; text: string };

export type ToolBlock = {
  ref: string;
  page: string;
  pos: number;
  code: string;
  priority: number;
  // Runs in the restricted boot pre-pass too (see bootBlocks)
  boot: boolean;
};

export function compareToolBlocks(a: ToolBlock, b: ToolBlock): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  if (a.page !== b.page) {
    return a.page < b.page ? -1 : 1;
  }
  return a.pos - b.pos;
}

export function collectTooling(files: ToolingFile[]): {
  scripts: ToolBlock[];
  styles: ToolBlock[];
  themeStyles: ToolBlock[];
  themes: ThemeInfo[];
} {
  const scripts: ToolBlock[] = [];
  const styles: ToolBlock[] = [];
  const themeStyles: ToolBlock[] = [];
  const themes: ThemeInfo[] = [];
  for (const file of files) {
    const page = file.path.replace(/\.md$/, "");
    if (!isToolPage(page)) {
      continue;
    }
    const tree = parseMarkdown(file.text);
    // Unparseable frontmatter yields no tags, so it stays an ordinary page
    const theme = themeInfoFromFrontmatter(page, findFrontmatter(tree));
    if (theme && theme !== "invalid") {
      themes.push(theme);
    }
    for (const block of findToolBlocks(tree)) {
      const isLua = block.fence === "space-lua";
      const entry: ToolBlock = {
        ref: `${page}@${block.from}`,
        page,
        pos: block.from,
        code: block.code,
        priority: block.priority ?? 0,
        boot: isLua && isBootScript(page, block.code),
      };
      if (isLua) {
        scripts.push(entry);
      } else if (theme === undefined) {
        styles.push(entry);
      } else if (theme !== "invalid") {
        themeStyles.push(entry);
      } // A theme without a valid scheme: its styles must not leak into every theme
    }
  }
  return {
    scripts: scripts.sort(compareToolBlocks),
    styles: styles.sort(compareToolBlocks),
    themeStyles: themeStyles.sort(compareToolBlocks),
    themes,
  };
}

/** The scripts the boot pre-pass runs, in tooling order (input is already sorted). */
export function bootBlocks(scripts: ToolBlock[]): ToolBlock[] {
  return scripts.filter((b) => b.boot);
}
