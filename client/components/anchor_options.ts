import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";

/**
 * An `anchor`-tagged object as stored in the index.
 *
 * `snippet` and `pageLastModified` were added after anchors shipped, and
 * introducing them did not bump `desiredIndexVersion` — deliberately, to
 * avoid forcing every existing space through a full reindex. Records
 * written before that change therefore have neither, and both must stay
 * optional. They fill in on their own as pages get re-indexed.
 */
export type AnchorObject = {
  ref: string;
  page: string;
  hostTag: string;
  snippet?: string;
  pageLastModified?: string;
};

const MAX_DESCRIPTION_LENGTH = 100;

export function anchorDescription(anchor: AnchorObject): string {
  const firstLine = anchor.snippet?.split("\n")[0].trim();
  if (!firstLine) {
    // Also the path taken by page-level (frontmatter `$ref`) anchors, which
    // have no host block to snippet.
    return `${anchor.hostTag} on ${anchor.page}`;
  }
  const truncated =
    firstLine.length > MAX_DESCRIPTION_LENGTH
      ? `${firstLine.slice(0, MAX_DESCRIPTION_LENGTH)}…`
      : firstLine;
  return `${truncated} — ${anchor.page}`;
}

export function anchorOrderId(anchor: AnchorObject): number | undefined {
  if (!anchor.pageLastModified) {
    return undefined;
  }
  const time = new Date(anchor.pageLastModified).getTime();
  if (Number.isNaN(time)) {
    // NaN doesn't merely misplace this row: it makes the sort comparator
    // non-transitive and scrambles the whole list. `compareOrderId` treats
    // undefined as 0, which parks the row after real timestamps.
    return undefined;
  }
  return -time;
}

export function anchorToFilterOption(anchor: AnchorObject): FilterOption {
  return {
    type: "anchor",
    meta: anchor,
    // The `$` is part of the name so the typed phrase ("$re") fuzzy-matches
    // the option directly, with no phrase preprocessing.
    name: `$${anchor.ref}`,
    description: anchorDescription(anchor),
    hint: anchor.hostTag,
    orderId: anchorOrderId(anchor),
  };
}

export function anchorsToFilterOptions(
  anchors: AnchorObject[],
): FilterOption[] {
  return anchors.map(anchorToFilterOption);
}
