import {
  datastore,
  index,
  markdown,
} from "@silverbulletmd/silverbullet/syscalls";
import {
  extractFrontMatter as extractFrontmatterFromTree,
  type FrontMatter,
  type FrontMatterExtractOptions,
} from "./frontmatter.ts";
import {
  collectNodesOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { applyPatches, type YamlPatch } from "../../plug-api/lib/yaml.ts";
import { LuaCollectionQuery } from "../../client/space_lua/query_collection.ts";
import { ObjectValue } from "@silverbulletmd/silverbullet/type/index";

/*
 * Key namespace:
 * [indexKey, type, ...key, page] -> value
 * [pageKey, page, ...key] -> true // for fast page clearing
 * ["type", type] -> true // for fast type listing
 */

export async function extractFrontmatter(
  text: string,
  extractOptions: FrontMatterExtractOptions = {},
): Promise<{ frontmatter: FrontMatter; text: string }> {
  const tree = await markdown.parseMarkdown(text);
  const frontmatter = extractFrontmatterFromTree(tree, extractOptions);
  return { frontmatter, text: renderToText(tree) };
}

export async function patchFrontmatter(
  text: string,
  patches: YamlPatch[],
): Promise<string> {
  const tree = await markdown.parseMarkdown(text);
  const frontmatter = collectNodesOfType(tree, "FrontMatter");
  if (frontmatter.length === 0) {
    // No frontmatter found, create from patches
    const patchedFrontmatter = applyPatches("", patches).trim();
    if (patchedFrontmatter) {
      return "---\n" + patchedFrontmatter + "\n---\n" + text;
    } else {
      return text;
    }
  } else {
    // Existing frontmatter found, patch it
    const frontmatterText = renderToText(frontmatter[0].children![1]);
    const patchedFrontmatter = applyPatches(frontmatterText, patches).trim();

    if (patchedFrontmatter) {
      // Replace the frontmatter with the patched frontmatter in the original string
      return "---\n" + patchedFrontmatter + "\n---" +
        text.slice(frontmatter[0].to);
    } else {
      // Nothing left, let's just return the text content
      return text.slice(frontmatter[0].to! + 1); // +1 to skip the initial \n
    }
  }
}

// DEPRECATED: use index.queryLuaObjects directly
export function queryLuaObjects<T>(
  tag: string,
  query: LuaCollectionQuery,
  scopedVariables?: Record<string, any>,
): Promise<ObjectValue<T>[]> {
  return index.queryLuaObjects(tag, query, scopedVariables);
}

// DEPRECATED: use index.getObjectByRef directly
export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<ObjectValue<T> | undefined> {
  return index.getObjectByRef(page, tag, ref);
}
