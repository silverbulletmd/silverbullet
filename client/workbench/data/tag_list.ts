/** The Data tab's tag list: pinned tags, then user tags with and without a schema, then built-ins. */
import {
  builtinTagsOfKind,
  isBuiltinTag,
} from "@silverbulletmd/silverbullet/lib/tags";

/** Built-in tags other than system ones, in kind order: the order a tag's roots are listed in */
const QUERY_ROOTS = (["root", "edge", "index"] as const).flatMap((kind) =>
  builtinTagsOfKind(kind),
);

/** The Feather icon a tag is shown with: its own, else its pages' decoration icon. */
export function tagIcon(definitions: Record<string, any>, tag: string): string {
  const def = definitions[tag];
  return def?.icon ?? def?.pageDecoration?.icon ?? "tag";
}

export type TagListEntry = {
  name: string;
  icon: string;
  count: number;
  /** Has a schema in its definition */
  defined: boolean;
  /** A root tag data blocks define (```#contact) */
  data: boolean;
  builtIn: boolean;
  /** The built-in root tags whose objects carry this tag (a data block's root is not one) */
  roots: string[];
  /** Sampled objects that fail the schema; set once the Schema view has looked */
  invalid?: number;
};

export type TagListSections = {
  pinned: TagListEntry[];
  defined: TagListEntry[];
  noSchema: TagListEntry[];
  builtIn: TagListEntry[];
};

export type TagListInput = {
  /** Tag objects from the index */
  records: { name: string; parent?: string }[];
  definitions: Record<string, any>;
  counts: Record<string, number>;
  pinned: string[];
  invalid?: Record<string, number>;
};

const byCount = (a: TagListEntry, b: TagListEntry) =>
  b.count - a.count || a.name.localeCompare(b.name);
const byName = (a: TagListEntry, b: TagListEntry) =>
  a.name.localeCompare(b.name);

export function buildTagList(input: TagListInput): TagListSections {
  const { records, definitions, counts, pinned, invalid = {} } = input;
  const dataRoots = new Set(
    records.filter((r) => r.parent === "data").map((r) => r.name),
  );
  const parents = new Map<string, Set<string>>();
  for (const { name, parent } of records) {
    if (!parent || parent === "data") continue;
    parents.set(name, (parents.get(name) ?? new Set()).add(parent));
  }
  const entries = new Map<string, TagListEntry>();
  for (const name of [
    ...records.map((r) => r.name),
    ...Object.keys(definitions),
  ]) {
    if (entries.has(name)) continue;
    entries.set(name, {
      name,
      icon: tagIcon(definitions, name),
      count: counts[name] ?? 0,
      defined: definitions[name]?.schema != null,
      data: dataRoots.has(name),
      builtIn: isBuiltinTag(name),
      roots: QUERY_ROOTS.filter((r) => parents.get(name)?.has(r)),
      ...(invalid[name] !== undefined ? { invalid: invalid[name] } : {}),
    });
  }
  const pinnedSet = new Set(pinned);
  const rest = [...entries.values()].filter((e) => !pinnedSet.has(e.name));
  return {
    pinned: pinned.flatMap((name) => entries.get(name) ?? []),
    defined: rest.filter((e) => !e.builtIn && e.defined).sort(byCount),
    noSchema: rest.filter((e) => !e.builtIn && !e.defined).sort(byCount),
    builtIn: rest.filter((e) => e.builtIn).sort(byName),
  };
}

export function filterTagList(
  sections: TagListSections,
  phrase: string,
): TagListSections {
  const p = phrase.trim().replace(/^#/, "").toLowerCase();
  if (!p) return sections;
  const pick = (list: TagListEntry[]) =>
    list.filter((e) => e.name.toLowerCase().includes(p));
  return {
    pinned: pick(sections.pinned),
    defined: pick(sections.defined),
    noSchema: pick(sections.noSchema),
    builtIn: pick(sections.builtIn),
  };
}

/** The tags a root tag's objects can be narrowed to: user tags used on them; for `data`, the root tags data blocks define */
export function narrowingTags(entries: TagListEntry[], root: string): string[] {
  return entries
    .filter(
      (e) => !e.builtIn && (root === "data" ? e.data : e.roots.includes(root)),
    )
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

export function allEntries(sections: TagListSections): TagListEntry[] {
  return [
    ...sections.pinned,
    ...sections.defined,
    ...sections.noSchema,
    ...sections.builtIn,
  ];
}
