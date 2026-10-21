/**
 * Where a query's objects come from: a root tag, a user tag, or the objects
 * of a root tag that carry a user tag. A query always reads them through an
 * `index.*()` helper.
 */
import {
  builtinTagKind,
  metaPageLua,
} from "@silverbulletmd/silverbullet/lib/tags";

export type QuerySource = {
  /** Root tag; `data` also stands for the root tags data blocks define */
  root: string | null;
  /**
   * User tag. With root `data`, it can also be a root tag a data block
   * defines (```#contact); with root `relation`, it's the relation kind.
   */
  tag: string | null;
  /** Which of the two was picked from the tag list; the other narrows it */
  by: "root" | "tag";
  /** With root `page`: only content pages, or only meta pages; all when absent */
  scope?: PageScope;
};

export type PageScope = "content" | "meta";

/** The helper reading each page scope's pages, narrowed by a user tag like `index.pages` */
const SCOPE_HELPERS: Record<PageScope, string> = {
  content: "contentPages",
  meta: "metaPages",
};

/** Root tags whose helper takes a user tag (or, for relations, a kind) to narrow by */
const NARROWING_HELPERS: Record<string, string> = {
  page: "pages",
  task: "tasks",
  item: "items",
  paragraph: "paragraphs",
  header: "headers",
  table: "tables",
  data: "data",
  relation: "relations",
};

/** Tags whose helper takes no argument */
const PLAIN_HELPERS: Record<string, string> = {
  document: "documents",
  tag: "tags",
  "aspiring-page": "aspiringPages",
  "ambiguous-link": "ambiguousLinks",
};

const own = (table: Record<string, string>, key: string) =>
  Object.hasOwn(table, key) ? table[key] : undefined;

const keyOf = (table: Record<string, string>, helper: string) =>
  Object.keys(table).find((k) => table[k] === helper);

export function rootSource(root: string): QuerySource {
  return { root, tag: null, by: "root" };
}

export function tagSource(tag: string): QuerySource {
  return { root: null, tag, by: "tag" };
}

/** The objects of a root tag a data block defines (```#contact) */
export function dataRootSource(name: string): QuerySource {
  return { root: "data", tag: name, by: "root" };
}

/** The source picking a root tag from the tag list reads: for pages, content pages */
export function listedSource(root: string): QuerySource {
  return root === "page"
    ? { ...rootSource(root), scope: "content" }
    : rootSource(root);
}

/** The source a tag stands for on its own: a built-in tag is a root, anything else a user tag */
export function sourceFor(name: string): QuerySource {
  return builtinTagKind(name) ? rootSource(name) : tagSource(name);
}

/** Whether a root tag's objects can be narrowed down to those carrying a user tag (or kind) */
export function canNarrow(root: string): boolean {
  return own(NARROWING_HELPERS, root) !== undefined;
}

/** The `index.*()` call a query reads its objects from */
export function sourceLua(s: QuerySource): string {
  if (s.root !== null) {
    const narrowing =
      s.root === "page" && s.scope
        ? SCOPE_HELPERS[s.scope]
        : own(NARROWING_HELPERS, s.root);
    if (narrowing) {
      return `index.${narrowing}(${s.tag !== null ? JSON.stringify(s.tag) : ""})`;
    }
    const plain = own(PLAIN_HELPERS, s.root);
    if (plain) return `index.${plain}()`;
    return `index.objects(${JSON.stringify(s.root)})`;
  }
  return `index.objects(${JSON.stringify(s.tag ?? "")})`;
}

/** The source an `index.<helper>(arg)` call reads, or null if the builder can't show it */
export function sourceFromCall(
  helper: string,
  arg: string | null,
): QuerySource | null {
  if (helper === "objects" || helper === "tag") {
    return arg === null ? null : sourceFor(arg);
  }
  const scope = keyOf(SCOPE_HELPERS, helper) as PageScope | undefined;
  if (scope) return { root: "page", tag: arg, by: "root", scope };
  const narrowing = keyOf(NARROWING_HELPERS, helper);
  if (narrowing) return { root: narrowing, tag: arg, by: "root" };
  const plain = keyOf(PLAIN_HELPERS, helper);
  if (plain && arg === null) return rootSource(plain);
  return null;
}

/** The kind of objects read, as templates' `@param` types and variable names use it */
export function sourceType(s: QuerySource): string {
  if (s.root === "data" && s.tag !== null) return s.tag;
  return s.root ?? s.tag ?? "";
}

/** The tag whose schema describes the objects beyond their root tag's fields */
export function schemaTag(s: QuerySource): string {
  if (s.root === "relation" || s.tag === null) return s.root ?? "";
  return s.tag;
}

/** How the source reads in a sentence: `task`, `#work`, `task tagged #work` */
export function sourceLabel(s: QuerySource): string {
  if (s.root === null) return `#${s.tag}`;
  const root = s.scope ? `${s.scope} ${s.root}` : s.root;
  if (s.tag === null) return root;
  if (s.root === "relation") return `${s.tag} relation`;
  if (s.root === "data") return `data tagged ${s.tag}`;
  return `${root} tagged #${s.tag}`;
}

export function sameSource(a: QuerySource, b: QuerySource): boolean {
  return a.root === b.root && a.tag === b.tag && a.scope === b.scope;
}

/**
 * The index entries to sample for the source's fields: the tag they're
 * stored under, and a Lua condition on `o` that keeps the source's ones
 */
export function sampleQuery(s: QuerySource): { key: string; where?: string } {
  if (s.root === null) return { key: s.tag ?? "" };
  if (s.scope) {
    const scoped =
      s.scope === "meta" ? metaPageLua("o") : `not ${metaPageLua("o")}`;
    if (s.tag === null) return { key: s.root, where: scoped };
    return { key: s.tag, where: `o.tag == "page" and ${scoped}` };
  }
  if (s.tag === null) return { key: s.root };
  const tag = JSON.stringify(s.tag);
  if (s.root === "relation")
    return { key: "relation", where: `o.kind == ${tag}` };
  if (s.root === "data") {
    return {
      key: s.tag,
      where: 'table.find(o.itags, function(t) return t == "data" end)',
    };
  }
  return { key: s.tag, where: `o.tag == ${JSON.stringify(s.root)}` };
}
