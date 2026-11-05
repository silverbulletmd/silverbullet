import {
  dataRootSource,
  listedSource,
  type QuerySource,
  tagSource,
} from "../query/query_from.ts";
import type { TagListEntry } from "./tag_list.ts";

/** The query source a tag-list entry stands for */
export function sourceForEntry(entry: TagListEntry): QuerySource {
  if (entry.builtIn) return listedSource(entry.name);
  if (entry.data) return dataRootSource(entry.name);
  return tagSource(entry.name);
}

/** The tag-list entry a query source belongs to; narrowing keeps it */
export function tagOfSource(s: QuerySource): string | null {
  if (s.by === "tag") return s.tag;
  if (s.root === "data" && s.tag !== null) return s.tag;
  return s.root;
}
