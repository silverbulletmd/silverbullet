import { parseToRef, type Ref } from "@silverbulletmd/silverbullet/lib/ref";
import { stdLibPrefix } from "../spaces/constants.ts";
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
export function blockSourceRef(
  ref: string,
  fence: "space-lua" | "space-style",
): Ref | null {
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
