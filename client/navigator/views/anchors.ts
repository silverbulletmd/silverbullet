import { editor, index } from "@silverbulletmd/silverbullet/syscalls";
import { baseMeta, type BuiltinView, INDEX_REFRESH_EVENTS } from "./types.ts";

const MAX_ANCHOR_DESCRIPTION = 100;

export const anchorPicker: BuiltinView = {
  meta: baseMeta({
    title: "Anchors",
    label: "Open",
    placeholder: "Anchor",
    refreshOn: INDEX_REFRESH_EVENTS,
    // Rows are named bare (the `$` is the row's icon's job), so a phrase that
    // carries the sigil still finds them.
    stripPrefix: "$",
    // Named explicitly rather than left to the panel's defaults, so the page
    // an anchor lives on is matchable too -- "intro proj" finds `$intro` on
    // Projects/Alpha.
    filterFields: {
      primary: { weight: 1.0, segments: true },
      page: { weight: 0.6, segments: true },
      description: 0.4,
    },
  }),
  row: {
    primary: (obj) => String(obj.ref),
    description: (obj) => {
      const firstLine = String(obj.snippet ?? "")
        .split("\n")[0]
        .trim();
      if (!firstLine) {
        // Also the path a page-level (frontmatter `$ref`) anchor takes: it has
        // no host block to snippet.
        return `${obj.hostTag ?? "anchor"} on ${obj.page}`;
      }
      const truncated =
        firstLine.length > MAX_ANCHOR_DESCRIPTION
          ? `${firstLine.slice(0, MAX_ANCHOR_DESCRIPTION)}…`
          : firstLine;
      return `${truncated} — ${obj.page}`;
    },
    decorations: (obj) =>
      obj.hostTag ? [{ text: obj.hostTag, position: "right" }] : undefined,
    icon: () => "anchor",
  },
  source: async () => {
    if (!(await index.isAvailable())) return [];
    const anchors = await index.queryLuaObjects<Record<string, any>>(
      "anchor",
      {} as any,
    );
    return [...anchors].sort((a, b) =>
      String(b.pageLastModified ?? "").localeCompare(
        String(a.pageLastModified ?? ""),
      ),
    );
  },
  onSelect: (obj) =>
    // Page-qualified deliberately: duplicate anchor names each get their own
    // row, and this opens the one that was picked instead of tripping the
    // ambiguous-anchor error.
    editor.navigate({
      path: `${obj.page}.md`,
      details: { type: "anchor", name: obj.ref },
    } as any),
};
