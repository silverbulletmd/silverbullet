import { parseToRef, type Ref } from "@silverbulletmd/silverbullet/lib/ref";
import {
  findToolBlocks,
  type ToolFence,
} from "@silverbulletmd/silverbullet/lib/tool_pages";
import { parseMarkdown } from "../../markdown_parser/parser.ts";
import { stdLibPrefix } from "../../spaces/constants.ts";
import { scriptRefParts } from "./source_frames.ts";

/**
 * What the Scripts and Styles tabs list: a fenced `space-lua` or
 * `space-style` block, identified by its ref, `Page@offset` (the offset of
 * the block's opening fence).
 */
export type SpaceBlock = { ref: string };

export type BlockOrigin = "all" | "custom" | "builtin";

/** Shipped with SilverBullet: a block on a `Library/Std/` page. Everything else, installed libraries included, is custom. */
export function isBuiltinBlock(b: SpaceBlock): boolean {
  return b.ref.startsWith(stdLibPrefix);
}

/** The blocks of one origin, in their original order. */
export function blocksFrom<B extends SpaceBlock>(
  blocks: B[],
  origin: BlockOrigin,
): B[] {
  if (origin === "all") return blocks;
  const builtin = origin === "builtin";
  return blocks.filter((b) => isBuiltinBlock(b) === builtin);
}

export function originCounts(
  blocks: SpaceBlock[],
): Record<BlockOrigin, number> {
  const builtin = blocks.filter(isBuiltinBlock).length;
  return { all: blocks.length, custom: blocks.length - builtin, builtin };
}

export function refMatches(b: SpaceBlock, text: string): boolean {
  const needle = text.trim().toLowerCase();
  return !needle || b.ref.toLowerCase().includes(needle);
}

/**
 * Each block's page name, plus its offset in the page when the page holds
 * more than one block, so its rows can be told apart.
 */
export function blockLabels(
  blocks: SpaceBlock[],
): Map<string, { page: string; pos?: number }> {
  const parts = new Map(blocks.map((b) => [b.ref, scriptRefParts(b.ref)]));
  const perPage = new Map<string, number>();
  for (const { page } of parts.values()) {
    perPage.set(page, (perPage.get(page) ?? 0) + 1);
  }
  return new Map(
    [...parts].map(([ref, { page, pos }]) => [
      ref,
      (perPage.get(page) ?? 0) > 1 ? { page, pos } : { page },
    ]),
  );
}

/** Where a block's code starts: its ref points at the opening fence line. */
export function blockSourceRef(ref: string, fence: ToolFence): Ref | null {
  const parsed = parseToRef(ref);
  if (parsed?.details?.type !== "position") return parsed;
  return {
    ...parsed,
    details: {
      type: "position",
      pos: parsed.details.pos + `\`\`\`${fence}\n`.length,
    },
  };
}

/**
 * Where a listed block's code starts in `text`, the page as it is now. A
 * block's ref holds its offset at the last load, which goes stale as soon as
 * the page is edited, so the block is looked up again: the one with the same
 * code (nearest the old offset when several match), else the one at the same
 * `rank` among the page's blocks of that kind. Unset when there is none.
 */
export function currentBlockStart(
  text: string,
  fence: ToolFence,
  code: string,
  pos: number,
  rank: number,
): number | undefined {
  const candidates = findToolBlocks(parseMarkdown(text)).filter(
    (b) => b.fence === fence,
  );
  let best: (typeof candidates)[number] | undefined;
  for (const b of candidates) {
    if (b.code !== code) continue;
    if (!best || Math.abs(b.from - pos) < Math.abs(best.from - pos)) best = b;
  }
  return (best ?? candidates[rank])?.codeFrom;
}

/** How many of `blocks` sit on the same page as `ref`, before it. */
export function blockRank(blocks: SpaceBlock[], ref: string): number {
  const { page, pos = 0 } = scriptRefParts(ref);
  return blocks.filter((b) => {
    const other = scriptRefParts(b.ref);
    return other.page === page && (other.pos ?? 0) < pos;
  }).length;
}
