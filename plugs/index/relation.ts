import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { index, lua, space } from "@silverbulletmd/silverbullet/syscalls";
import type { FrontMatter } from "./frontmatter.ts";
import {
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { buildLineIndex, extractSnippet } from "./snippet.ts";
import {
  mdLinkRegex,
  wikiLinkRegex,
} from "../../client/markdown_parser/constants.ts";
import { collectAnchor } from "./anchor.ts";

// ---- Types ----

export type RelationKind =
  | "mention"
  | "attribute"
  | "frontmatter"
  | "data"
  | "co-mention"
  | "url"
  | "document";

/**
 * A page that does not yet exist but is being linked to. Emitted by
 * the relation indexer (see `emitAspiringPages` below).
 */
export type AspiringPageObject = ObjectValue<{
  page: string;
  pos: number;
  name: string;
}>;

export type RelationObject = ObjectValue<{
  tag: "relation";
  from: string;
  fromTag?: string;
  to: string;
  toTag?: string;
  kind: RelationKind;
  type?: string;
  via?: string;
  page: string;
  range: [number, number];
  alias?: string;
  snippet?: string;
  pageLastModified: string;
}>;

type EmitCtx = {
  pageMeta: PageMeta;
  lineIndex: ReturnType<typeof buildLineIndex>;
  out: RelationObject[];
};

type TextualEdgeArgs = {
  kind: RelationKind;
  from: string;
  fromTag: string;
  to: string;
  toTag?: string;
  range: [number, number];
  type?: string;
  alias?: string;
};

// ---- Constants ----

// Textual relation kinds: those carrying `range` and a source form
// that rename refactoring can splice. Also the set of relation kinds
// that participate in co-mention generation (each has an object-shaped
// target).
const TEXTUAL_RELATION_KINDS: Set<RelationKind> = new Set([
  "mention",
  "attribute",
  "frontmatter",
  "data",
  "document",
]);

// Tag used for `to` when a wikilink targets a `$anchor`. Anchors are
// space-global identifiers — the definition may live on any page and
// could be hosted by an item, task, or header. Rather than guessing
// (or doing an async cross-page lookup that may race with reindexing)
// we expose the meta-tag `anchor`; consumers can join with the item /
// task / header indices on the bare anchor name when they care.
const ANCHOR_TARGET_TAG = "anchor";

// Ref shape for relation records:
//
//   Textual edges (mention, attribute, frontmatter, data, url, document):
//     `${page}@${range[0]}`                       e.g. "Diary@142"
//
//   Co-mention edges:
//     `${page}@${a.start}${COMENTION_REF_INFIX}${to}` e.g. "Diary@142:com:Jack"
//
// All relation refs are page-rooted so the index can invalidate them
// per-page (mirrors the legacy `link` index). `range[0]` is the byte
// offset of the literal `[[` or `[` in the source page text — stable
// as long as the surrounding text doesn't shift, which gives rename
// refactoring a reliable anchor. The target ref is appended as an
// opaque string; co-mention refs are not meant to be parsed back out.
const COMENTION_REF_INFIX = ":com:";

// ---- Functions ----

function innermostContainer(
  node: ParseTree,
  pageName: string,
): { from: string; fromTag: string } {
  let cursor = node.parent;
  while (cursor) {
    if (cursor.type === "ListItem") {
      const taskNode = cursor.children?.find((c) => c.type === "Task");
      const hasTask = !!taskNode;
      // Mirror item.ts: collect anchor from the item's nameNode only so
      // sub-list anchors don't bleed into the parent's ref. For tasks
      // the nameNode is synthesized from the Task's trailing children.
      const nameNode = hasTask
        ? { type: "Paragraph", children: taskNode!.children!.slice(1) }
        : cursor.children?.find((c) => c.type === "Paragraph");
      const anchor = nameNode ? collectAnchor(nameNode) : null;
      return {
        from: anchor ? anchor.name : `${pageName}@${cursor.from}`,
        fromTag: hasTask ? "task" : "item",
      };
    }
    if (cursor.type === "FencedCode") {
      const codeInfoNode = cursor.children?.find((c) => c.type === "CodeInfo");
      const fenceType = codeInfoNode?.children?.[0]?.text;
      if (fenceType?.startsWith("#")) {
        return {
          from: `${pageName}@${cursor.from}`,
          fromTag: fenceType.substring(1),
        };
      }
    }
    cursor = cursor.parent;
  }
  return { from: pageName, fromTag: "page" };
}

function emitWikiLinksInRange(
  ctx: EmitCtx,
  text: string,
  baseOffset: number,
  edge: { kind: RelationKind; from: string; fromTag: string; type?: string },
): void {
  wikiLinkRegex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = wikiLinkRegex.exec(text)) !== null) {
    const { stringRef, alias } = m.groups as {
      stringRef: string;
      alias?: string;
    };
    const ref = parseToRef(stringRef);
    if (!ref) continue;
    const pos = baseOffset + m.index!;
    const range: [number, number] = [pos, pos + m[0].length];
    if (ref.path === "") {
      if (ref.details?.type === "anchor") {
        emitTextualEdge(ctx, {
          ...edge,
          to: ref.details.name,
          toTag: ANCHOR_TARGET_TAG,
          range,
          alias,
        });
      }
      continue;
    }
    const isPage = isMarkdownPath(ref.path);
    emitTextualEdge(ctx, {
      ...edge,
      to: isPage ? getNameFromPath(ref.path) : ref.path,
      toTag: isPage ? "page" : "document",
      range,
      alias,
    });
  }
}

function emitTextualEdge(ctx: EmitCtx, args: TextualEdgeArgs): void {
  const [start, end] = args.range;
  const rec: RelationObject = {
    ref: `${ctx.pageMeta.name}@${start}`,
    tag: "relation",
    kind: args.kind,
    from: args.from,
    fromTag: args.fromTag,
    to: args.to,
    page: ctx.pageMeta.name,
    range: [start, end],
    snippet: extractSnippet(ctx.pageMeta.name, ctx.lineIndex, start),
    pageLastModified: ctx.pageMeta.lastModified,
  };
  if (args.type) rec.type = args.type;
  if (args.toTag) rec.toTag = args.toTag;
  if (args.alias) rec.alias = args.alias;
  ctx.out.push(rec);
}

export async function indexRelations(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
  pageText: string,
): Promise<ObjectValue<any>[]> {
  if (frontmatter.tags?.find((t) => t.startsWith("meta/template"))) {
    return [];
  }

  addParentPointers(tree);

  const ctx: EmitCtx = {
    pageMeta,
    lineIndex: buildLineIndex(pageText),
    out: [],
  };

  const pageFrom = pageMeta.name;
  const pageFromTag = "page";

  traverseTree(
    tree,
    (n) => {
      if (n.type === "WikiLink") {
        const wikiLinkPage = findNodeOfType(n, "WikiLinkPage");
        if (!wikiLinkPage) return true;
        const ref = parseToRef(wikiLinkPage.children![0].text!);
        if (!ref) return true;
        const { from, fromTag } = innermostContainer(n, pageMeta.name);
        const alias = findNodeOfType(n, "WikiLinkAlias")?.children?.[0].text;
        // Same-page wikilinks (`[[#Heading]]`, `[[@123]]`, `[[$anchor]]`).
        // Only `$anchor` points at an indexed object — items and headers
        // with `$name` are stored under `ref = name`. The header/position
        // forms are intra-page UI nav and aren't worth recording as edges.
        if (ref.path === "") {
          if (ref.details?.type === "anchor") {
            emitTextualEdge(ctx, {
              kind: "mention",
              from,
              fromTag,
              to: ref.details.name,
              toTag: ANCHOR_TARGET_TAG,
              range: [n.from!, n.to!],
              alias,
            });
          }
          return true;
        }
        const isPage = isMarkdownPath(ref.path);
        emitTextualEdge(ctx, {
          // `[[X.jpg]]` (or any non-markdown target) is a document edge,
          // matching the legacy `link.type = "file"` classification.
          kind: isPage ? "mention" : "document",
          from,
          fromTag,
          to: isPage ? getNameFromPath(ref.path) : ref.path,
          toTag: isPage ? "page" : "document",
          range: [n.from!, n.to!],
          alias,
        });
        return true;
      }

      if (n.type === "Link" || n.type === "Image") {
        mdLinkRegex.lastIndex = 0;
        const match = mdLinkRegex.exec(renderToText(n));
        if (!match) return false;
        const { title: alias, url } = match.groups as {
          url: string;
          title: string;
        };
        const { from, fromTag } = innermostContainer(n, pageMeta.name);
        const base = {
          from,
          fromTag,
          range: [n.from!, n.to!] as [number, number],
          alias,
        };
        if (!isLocalURL(url)) {
          emitTextualEdge(ctx, { ...base, kind: "url", to: url });
          return true;
        }
        const ref = parseToRef(
          resolveMarkdownLink(pageMeta.name, decodeURI(url)),
        );
        if (!ref) return true;
        if (isMarkdownPath(ref.path)) {
          emitTextualEdge(ctx, {
            ...base,
            kind: "mention",
            to: getNameFromPath(ref.path),
            toTag: "page",
          });
        } else {
          emitTextualEdge(ctx, {
            ...base,
            kind: "document",
            to: ref.path,
            toTag: "document",
          });
        }
        return true;
      }

      if (n.type === "FencedCode") {
        const codeInfoNode = findNodeOfType(n, "CodeInfo");
        if (!codeInfoNode) return true;
        const fenceType = codeInfoNode.children![0].text!;
        if (!fenceType.startsWith("#")) return true;
        const dataType = fenceType.substring(1);
        const codeTextNode = findNodeOfType(n, "CodeText");
        if (!codeTextNode) return true;
        const codeText = codeTextNode.children![0].text!;
        const blockRef = `${pageMeta.name}@${n.from!}`;

        const lineKeyRegex = /^(\s*)([\w$][\w$\- ]*)\s*:\s*(.*)$/;
        let cursor = 0;
        for (const line of codeText.split("\n")) {
          const m = lineKeyRegex.exec(line);
          if (m) {
            const valueOffset = m[0].length - m[3].length;
            emitWikiLinksInRange(
              ctx,
              m[3],
              codeTextNode.from! + cursor + valueOffset,
              {
                kind: "data",
                from: blockRef,
                fromTag: dataType,
                type: m[2].trim(),
              },
            );
          }
          cursor += line.length + 1;
        }
        return true;
      }

      if (n.type === "Attribute") {
        const nameNode = findNodeOfType(n, "AttributeName");
        const valueNode = findNodeOfType(n, "AttributeValue");
        if (!nameNode || !valueNode) return true;
        const { from, fromTag } = innermostContainer(n, pageMeta.name);
        emitWikiLinksInRange(
          ctx,
          valueNode.children![0].text!,
          valueNode.from!,
          {
            kind: "attribute",
            from,
            fromTag,
            type: nameNode.children![0].text!,
          },
        );
        return true;
      }

      if (n.type === "FrontMatter") {
        for (const { key, valueNode } of frontmatterStringEntries(n)) {
          const text = valueNode.children![0].text!;
          const trimmed = text.replace(/^["'\s]*/, "").replace(/["'\s]*$/, "");
          wikiLinkRegex.lastIndex = 0;
          const match = wikiLinkRegex.exec(text);
          if (!match?.groups || match[0] !== trimmed) continue;
          const { stringRef, alias } = match.groups as {
            stringRef: string;
            alias?: string;
          };
          const ref = parseToRef(stringRef);
          if (!ref) continue;
          const start = valueNode.from! + match.index!;
          const range: [number, number] = [start, start + match[0].length];
          const base = {
            kind: "frontmatter" as const,
            type: key,
            from: pageFrom,
            fromTag: pageFromTag,
            range,
            alias,
          };
          if (ref.path === "") {
            if (ref.details?.type === "anchor") {
              emitTextualEdge(ctx, {
                ...base,
                to: ref.details.name,
                toTag: ANCHOR_TARGET_TAG,
              });
            }
            continue;
          }
          const isPage = isMarkdownPath(ref.path);
          emitTextualEdge(ctx, {
            ...base,
            to: isPage ? getNameFromPath(ref.path) : ref.path,
            toTag: isPage ? "page" : "document",
          });
        }
        return true;
      }
      return false;
    },
    true,
  );

  emitCoMentions(ctx, tree);
  await emitAspiringPages(ctx);
  return ctx.out;
}

// Emits one `aspiring-page` record per (page-targeted) ref that does
// not resolve to a real page in the space. Lives here because it
// piggybacks on the relation indexer's page-resolution work — every
// `mention` / `frontmatter` record with `toTag = "page"` is a
// candidate. Mirrors the legacy `link.ts` behavior.
async function emitAspiringPages(ctx: EmitCtx): Promise<void> {
  const candidates = ctx.out.filter(
    (r): r is RelationObject & { range: [number, number] } =>
      (r.kind === "mention" || r.kind === "frontmatter") &&
      r.toTag === "page" &&
      Array.isArray(r.range),
  );
  if (candidates.length === 0) return;

  const uniqueTargets = [...new Set(candidates.map((r) => r.to))];
  const existence = await Promise.all(
    uniqueTargets.map((t) => space.fileExists(`${t}.md`)),
  );
  const missing = new Set(uniqueTargets.filter((_, i) => !existence[i]));
  if (missing.size === 0) return;

  for (const rec of candidates) {
    if (!missing.has(rec.to)) continue;
    ctx.out.push({
      ref: `${ctx.pageMeta.name}@${rec.range[0]}`,
      tag: "aspiring-page",
      page: ctx.pageMeta.name,
      pos: rec.range[0],
      range: rec.range,
      name: rec.to,
    } as any);
    console.info(
      "Link from",
      ctx.pageMeta.name,
      "to",
      rec.to,
      "is broken, indexing as aspiring page",
    );
  }
}

// For each textual relation with an object target, collect ancestor
// ListItem and Paragraph chains. For each ordered pair sharing an
// ancestor, emit one co-mention edge using the innermost shared scope's
// ref as `via`. ListItem ancestors are preferred over Paragraph.
function emitCoMentions(ctx: EmitCtx, tree: ParseTree): void {
  // The parser does NOT emit WikiLink nodes inside AttributeValue (the
  // value is raw text), so we can't rely on a parent-pointer walk from
  // a wikilink node — attribute/data relations don't have one to walk
  // from. Instead, collect every ListItem / Paragraph range up front
  // and resolve each relation's containing scopes by range containment.
  type Scope = { from: number; to: number };
  const items: Scope[] = [];
  const paragraphs: Scope[] = [];
  traverseTree(
    tree,
    (n) => {
      if (n.type === "ListItem") items.push({ from: n.from!, to: n.to! });
      if (n.type === "Paragraph") paragraphs.push({ from: n.from!, to: n.to! });
      return false;
    },
    true,
  );
  // Innermost first by sorting descending on `from` (smaller scopes
  // appear later in document order than their enclosing scopes only
  // when nested — for siblings any order is fine because each relation
  // is inside exactly one of them).
  items.sort((a, b) => b.from - a.from);
  paragraphs.sort((a, b) => b.from - a.from);

  const ancestorsFor = (
    pos: number,
  ): { items: number[]; paragraphs: number[] } => {
    const it = items
      .filter((s) => s.from <= pos && pos < s.to)
      .map((s) => s.from);
    const pa = paragraphs
      .filter((s) => s.from <= pos && pos < s.to)
      .map((s) => s.from);
    return { items: it, paragraphs: pa };
  };

  type Mention = {
    rec: RelationObject;
    items: number[];
    paragraphs: number[];
    itemSet: Set<number>;
    paraSet: Set<number>;
  };
  const mentions: Mention[] = [];
  for (const rec of ctx.out) {
    if (!TEXTUAL_RELATION_KINDS.has(rec.kind)) continue;
    if (rec.range === undefined) continue;
    const { items: itemAncestors, paragraphs: paragraphAncestors } =
      ancestorsFor(rec.range[0]);
    mentions.push({
      rec,
      items: itemAncestors,
      paragraphs: paragraphAncestors,
      itemSet: new Set(itemAncestors),
      paraSet: new Set(paragraphAncestors),
    });
  }

  const seenDirected = new Set<string>();
  for (let i = 0; i < mentions.length; i++) {
    const a = mentions[i];
    for (let j = 0; j < mentions.length; j++) {
      if (i === j) continue;
      const b = mentions[j];
      if (a.rec.to === b.rec.to) continue;
      const sharedItem = a.items.find((p) => b.itemSet.has(p));
      const sharedPara =
        sharedItem === undefined
          ? a.paragraphs.find((p) => b.paraSet.has(p))
          : undefined;
      const sharedPos = sharedItem ?? sharedPara;
      if (sharedPos === undefined) continue;

      const via = `${ctx.pageMeta.name}@${sharedPos}`;
      const key = `${a.rec.range![0]}->${b.rec.to}`;
      if (seenDirected.has(key)) continue;
      seenDirected.add(key);

      const rec: RelationObject = {
        ref: `${ctx.pageMeta.name}@${a.rec.range![0]}${COMENTION_REF_INFIX}${b.rec.to}`,
        tag: "relation",
        kind: "co-mention",
        from: a.rec.to,
        to: b.rec.to,
        via,
        // Anchor at the source-side wikilink so UI navigation /
        // snippet extraction has a position to use.
        range: a.rec.range,
        page: ctx.pageMeta.name,
        pageLastModified: ctx.pageMeta.lastModified,
      };
      if (a.rec.snippet) rec.snippet = a.rec.snippet;
      if (a.rec.toTag) rec.fromTag = a.rec.toTag;
      if (b.rec.toTag) rec.toTag = b.rec.toTag;
      ctx.out.push(rec);
    }
  }
}

/**
 * Collects the names of all wiki-link targets reachable from `n`,
 * stopping at nested lists (so a parent item's links don't include
 * its sub-items'). Used by `item.ts` to populate `item.links`.
 */
export function collectPageLinks(n: ParseTree): string[] {
  const links = new Set<string>();
  traverseTree(
    n,
    (n) => {
      if (n.type === "WikiLink") {
        links.add(findNodeOfType(n, "WikiLinkPage")!.children![0].text!);
        return true;
      } else if (n.type === "OrderedList" || n.type === "BulletList") {
        // Don't traverse into sub-lists
        return true;
      }
      return false;
    },
    true,
  );
  return [...links];
}

export async function getTextualBackRelations(
  to: string,
): Promise<RelationObject[]> {
  return await index.queryLuaObjects<RelationObject>(
    "relation",
    {
      objectVariable: "_",
      where: await lua.parseExpression(
        `_.to == name and (` +
          [...TEXTUAL_RELATION_KINDS]
            .map((k) => `_.kind == "${k}"`)
            .join(" or ") +
          `)`,
      ),
    },
    { name: to },
  );
}

function* frontmatterStringEntries(
  fmNode: ParseTree,
): Generator<{ key: string; valueNode: ParseTree }> {
  const docs = collectNodesOfType(fmNode, "Document");
  for (const doc of docs) {
    let lastKey: string | undefined;
    for (const child of doc.children ?? []) {
      if (child.type === "atom") {
        lastKey = child.children?.[0]?.text;
      } else if (child.type === "string" && lastKey) {
        yield { key: lastKey, valueNode: child };
        lastKey = undefined;
      }
    }
  }
}
