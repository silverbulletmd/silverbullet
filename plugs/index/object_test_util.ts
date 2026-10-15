import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { indexMarkdown } from "./indexer.ts";
import { type PlanContext, pageMetaFor } from "./object_edit.ts";

export async function objectsOf(
  text: string,
  page = "Notes",
): Promise<ObjectValue<any>[]> {
  return (await indexMarkdown(
    text,
    pageMetaFor(page),
  )) as unknown as ObjectValue<any>[];
}

export function planCtx(text: string): PlanContext {
  return { text, tree: parseMarkdown(text) };
}
