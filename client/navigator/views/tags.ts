import { config, editor, index } from "@silverbulletmd/silverbullet/syscalls";
import { open } from "../navigator.ts";
import { baseMeta, type BuiltinView, INDEX_REFRESH_EVENTS } from "./types.ts";

/** The row this view actually exposes: a tag name and how many things carry
 * it, aggregated from the index's own (genuinely `ObjectValue`) `"tag"`
 * entries below -- but the aggregate itself has no `ref`/`tag` of its own,
 * so it doesn't qualify as one. */
type TagRow = { name: string; count: number };

export const tagPicker: BuiltinView<TagRow> = {
  meta: baseMeta({
    title: "Tags",
    label: "Open",
    placeholder: "Tag",
    refreshOn: INDEX_REFRESH_EVENTS,
    // As with anchors: the `#` is the icon's job, not the label's.
    stripPrefix: "#",
    filterFields: { primary: { weight: 1.0, segments: true } },
  }),
  row: {
    primary: (obj) => String(obj.name),
    decorations: (obj) => [{ text: String(obj.count), position: "right" }],
    icon: () => "hash",
  },
  source: async () => {
    if (!(await index.isAvailable())) return [];
    // The index holds one record per tagged object, which is what makes the
    // count free.
    const counts = new Map<string, number>();
    for (const tag of await index.queryLuaObjects<{ name: string }>(
      "tag",
      {} as any,
    )) {
      counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },
  onSelect: async (obj, ctx) => {
    if (ctx.from) {
      // Reached by typing `#` into a picker: hand the slot back with the tag
      // applied, which is what a leading `#` used to do in place. `false`
      // keeps this panel from closing the view it just opened into itself.
      await open(ctx.from, { phrase: `#${obj.name} ` });
      return false;
    }
    const tagPage = await config.get<string | null>(
      ["tags", obj.name, "tagPage"],
      null,
    );
    await editor.navigate(tagPage ?? `tag:${obj.name}`);
  },
};
