import type { ViewMeta } from "./types.ts";

/**
 * Where a view's tree state is persisted, or `undefined` for a view whose
 * state is not persisted at all (`expansionScope: "page"` -- see `ViewMeta`).
 *
 * Two keys rather than one, because under `expandAll` the stored set means the
 * opposite thing -- the folders the user *closed* -- and reading one as the
 * other would invert a whole tree the first time a view flipped the flag.
 *
 * The `["navigator", …]` namespace is the navigator's own datastore convention
 * (the same one `activation.ts` uses for the remembered segment), which is
 * why this stays navigator-side rather than in the shared tree model.
 */
export function expansionKey(
  view: string,
  meta: Pick<ViewMeta, "expandAll" | "expansionScope" | "ephemeral">,
): string[] | undefined {
  if (meta.expansionScope === "page") return undefined;
  // A `navigator.pick` view: no key at all, the same "zero persistence" rule
  // the remembered segment follows (see `commands.ts`'s `pickSegment`).
  if (meta.ephemeral) return undefined;
  return ["navigator", view, meta.expandAll ? "collapsed" : "expanded"];
}
