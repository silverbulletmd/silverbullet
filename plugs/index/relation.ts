import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import {
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  lookupIndex,
  type ResolveResult,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
  findParentMatching,
  type ParseTree,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { index, lua, space } from "@silverbulletmd/silverbullet/syscalls";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import {
  mdLinkRegex,
  wikiLinkRegex,
} from "../../client/markdown_parser/constants.ts";
import { collectAnchor } from "./anchor.ts";
import type { FrontMatter } from "./frontmatter.ts";
import { parseDeclaredNames, identityId } from "./identity.ts";
import { buildLineIndex, extractSnippet } from "./snippet.ts";

// ---- Types ----

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
  kind: string;
  via?: string;
  page: string;
  /** Absent on records with no span in the page text, e.g. a `recipients:`
   * frontmatter nickname. */
  range?: [number, number];
  alias?: string;
  /** Recipient ids of the signature claiming this mention's text. Present
   * only on `at-mention` records that a signature's scope covers. */
  by?: string[];
  snippet?: string;
  pageLastModified: string;
}>;

type EmitCtx = {
  pageMeta: PageMeta;
  lineIndex: ReturnType<typeof buildLineIndex>;
  out: RelationObject[];
};

type TextualEdgeArgs = {
  kind: string;
  from: string;
  fromTag: string;
  to: string;
  toTag?: string;
  range: [number, number];
  alias?: string;
  by?: string[];
};

// ---- Constants ----

// Textual edges: authored edges with an in-space target. They carry a
// splice-able `range` and seed co-mention generation. Excludes derived
// co-mentions and external URLs (whose target is not an in-space object).
function isTextualEdge(r: { kind: string; toTag?: string }): boolean {
  return r.kind !== "co-mention" && r.toTag !== "url";
}

// Tag used for `to` when a wikilink targets a `$anchor`. Anchors are
// space-global identifiers — the definition may live on any page and
// could be hosted by an item, task, or header. Rather than guessing
// (or doing an async cross-page lookup that may race with reindexing)
// we expose the meta-tag `anchor`; consumers can join with the item /
// task / header indices on the bare anchor name when they care.
const ANCHOR_TARGET_TAG = "anchor";

// Ref shape for relation records:
//
//   Textual edges (kind "mention" or a user predicate, in-space target):
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
  edge: { kind: string; from: string; fromTag: string },
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
  if (args.toTag) rec.toTag = args.toTag;
  if (args.alias) rec.alias = args.alias;
  if (args.by?.length) rec.by = args.by;
  ctx.out.push(rec);
}

/** Blocks a signature can terminate. A task has no Paragraph ancestor of its
 * own, so it is listed here directly. */
const SIGNATURE_BLOCK_TYPES = new Set([
  "Paragraph",
  "Task",
  "ListItem",
  "CommentBlock",
  "Blockquote",
]);

/** Containers a standalone signature widens to. Deliberately excludes
 * Document: a signature at top level claims the block above it, not the page. */
const SIGNATURE_WIDEN_TYPES = new Set([
  "CommentBlock",
  "ListItem",
  "Blockquote",
]);

/** The nearest earlier sibling of `block` that holds any non-whitespace text. */
function previousSiblingBlock(
  block: ParseTree,
  pageText: string,
): ParseTree | undefined {
  const siblings = block.parent?.children ?? [];
  for (let i = siblings.indexOf(block) - 1; i >= 0; i--) {
    const sibling = siblings[i];
    if (sibling.from === undefined || sibling.to === undefined) continue;
    if (!/\S/.test(pageText.slice(sibling.from, sibling.to))) continue;
    return sibling;
  }
  return undefined;
}

/**
 * The span of text a signature claims authorship of.
 */
function signatureScope(
  sig: ParseTree,
  pageText: string,
): [number, number] | undefined {
  const block = findParentMatching(sig, (p) =>
    SIGNATURE_BLOCK_TYPES.has(p.type!),
  );
  if (!block || block.from === undefined || block.to === undefined) {
    return undefined;
  }

  const before = pageText.slice(block.from, sig.from!);
  const after = pageText.slice(sig.to!, block.to);
  if (/\S/.test(before) || /\S/.test(after)) {
    return [block.from, block.to];
  }

  const container = findParentMatching(block, (p) =>
    SIGNATURE_WIDEN_TYPES.has(p.type!),
  );
  if (container?.from !== undefined && container.to !== undefined) {
    return [container.from, container.to];
  }

  const previous = previousSiblingBlock(block, pageText);
  if (previous) {
    return [previous.from!, previous.to!];
  }
  return [block.from, block.to];
}

/**
 * The authors of the innermost signature whose scope contains `[from, to)`.
 *
 * Innermost wins and results are never unioned: a sub-item signed by Ada is
 * Ada's even inside a list Zef signed, because attributing it to both reads
 * as co-authorship rather than as a thread.
 */
function authorsFor(
  scopes: { names: string[]; scope: [number, number] }[],
  from: number,
  to: number,
): string[] | undefined {
  let best: string[] | undefined;
  let bestSize = Infinity;
  for (const { names, scope } of scopes) {
    if (scope[0] > from || to > scope[1]) continue;
    const size = scope[1] - scope[0];
    if (size < bestSize) {
      bestSize = size;
      best = names;
    }
  }
  return best;
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

  const atMentionNodes: ParseTree[] = [];
  const signatureNodes: ParseTree[] = [];
  const mentioned = new Map<string, string>();

  traverseTree(
    tree,
    (n) => {
      // Returning true stops the descent, so a signature's nested AtMention
      // nodes never reach `atMentionNodes`. That is the whole suppression
      // mechanism: no inbox has to exclude anything, because nothing that
      // would land in one is ever emitted.
      if (n.type === "AtMentionSignature") {
        signatureNodes.push(n);
        return true;
      }

      if (n.type === "AtMention") {
        atMentionNodes.push(n);
        return true;
      }

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
          kind: "mention",
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
          emitTextualEdge(ctx, {
            ...base,
            kind: "mention",
            to: url,
            toTag: "url",
          });
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
            kind: "mention",
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
                kind: m[2].trim(),
                from: blockRef,
                fromTag: dataType,
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
            kind: nameNode.children![0].text!,
            from,
            fromTag,
          },
        );
        return true;
      }

      if (n.type === "FrontMatter") {
        for (const { key, valueNode } of frontmatterStringEntries(n)) {
          // `authors:` credits a name; a wikilink there isn't a name, and
          // unlike `recipients:` it has no page-relation fallback to resolve
          // to — it's simply not a valid author entry, so it's dropped.
          if (key === "authors") continue;
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
            kind: key,
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
  await resolvePageTargets(ctx, pageText);

  // A mention records the nickname only, as the namespaced identifier
  // `@<lowercased nickname>` (so @Bob and @bob converge). Which
  // page — if any — claims that nickname is joined at read time, because
  // resolving it here would depend on whether the recipient's page happened
  // to be indexed first.
  const signatureScopes: { names: string[]; scope: [number, number] }[] = [];
  for (const sig of signatureNodes) {
    const scope = signatureScope(sig, pageText);
    if (!scope) continue;
    signatureScopes.push({
      names: collectNodesOfType(sig, "AtMention").map((n) =>
        identityId(renderToText(n).slice(1)),
      ),
      scope,
    });
  }

  for (const n of atMentionNodes) {
    const nickname = renderToText(n).slice(1);
    const { from, fromTag } = innermostContainer(n, pageMeta.name);
    emitTextualEdge(ctx, {
      kind: "at-mention",
      from,
      fromTag,
      to: identityId(nickname),
      toTag: "identity",
      range: [n.from!, n.to!],
      alias: nickname,
      by: authorsFor(signatureScopes, n.from!, n.to!),
    });
    if (!mentioned.has(identityId(nickname))) {
      mentioned.set(identityId(nickname), nickname);
    }
  }

  // A signature records who wrote the surrounding text. It anchors on its
  // own container so a task signature is filed under the task, and each name
  // carries its own range so co-signatures get distinct refs.
  for (const sig of signatureNodes) {
    const { from, fromTag } = innermostContainer(sig, pageMeta.name);
    for (const n of collectNodesOfType(sig, "AtMention")) {
      const nickname = renderToText(n).slice(1);
      emitTextualEdge(ctx, {
        kind: "authored",
        from,
        fromTag,
        to: identityId(nickname),
        toTag: "identity",
        range: [n.from!, n.to!],
        alias: nickname,
      });
      if (!mentioned.has(identityId(nickname))) {
        mentioned.set(identityId(nickname), nickname);
      }
    }
  }

  emitDeclaredNames(ctx, frontmatter.recipients, "recipients", mentioned);
  emitDeclaredNames(ctx, frontmatter.authors, "authored", mentioned);
  emitIdentities(ctx, mentioned);

  // A `recipients:` declaration addresses the whole page, so the frontmatter
  // line it happens to be written on identifies nothing — true of both the
  // nickname form (no range) and the wikilink form (a range, but only into
  // the frontmatter). Either way the page's opening line stands in instead.
  // `authors:` has the same problem, but only for its nickname form: an
  // inline `-- @zef` signature is also `kind: "authored"` and already has a
  // meaningful range-derived snippet of its own, which must not be clobbered.
  const summary = firstParagraphSnippet(ctx, tree);
  if (summary) {
    for (const rec of ctx.out) {
      if (
        rec.kind === "recipients" ||
        (rec.kind === "authored" && rec.range === undefined)
      ) {
        rec.snippet = summary;
      }
    }
  }

  return ctx.out;
}

/** The page's first top-level paragraph, snippet-truncated. */
function firstParagraphSnippet(
  ctx: EmitCtx,
  tree: ParseTree,
): string | undefined {
  let first: ParseTree | undefined;
  traverseTree(tree, (n) => {
    if (first) return true;
    if (n.type !== "Paragraph") return false;
    if (findParentMatching(n, (p) => p.type === "ListItem")) return true;
    first = n;
    return true;
  });
  return first
    ? extractSnippet(ctx.pageMeta.name, ctx.lineIndex, first.from!)
    : undefined;
}

/**
 * A frontmatter list of names, as relations with no range.
 *
 * `recipients:` addresses the page and puts it in an inbox; `authors:` credits
 * the page and must never create work. Same parse, same shape, opposite
 * direction — so they share everything but the `kind` and the ref namespace.
 */
function emitDeclaredNames(
  ctx: EmitCtx,
  value: unknown,
  kind: string,
  mentioned: Map<string, string>,
): void {
  for (const entry of parseDeclaredNames(value)) {
    wikiLinkRegex.lastIndex = 0;
    if (wikiLinkRegex.exec(entry)) continue;
    const name = entry.replaceAll(" ", "");
    if (name === "") continue;
    ctx.out.push({
      ref: `${ctx.pageMeta.name}@${kind}/${name.toLowerCase()}`,
      tag: "relation",
      kind,
      from: ctx.pageMeta.name,
      fromTag: "page",
      to: identityId(name),
      toTag: "identity",
      page: ctx.pageMeta.name,
      alias: name,
      pageLastModified: ctx.pageMeta.lastModified,
    });
    if (!mentioned.has(identityId(name))) {
      mentioned.set(identityId(name), name);
    }
  }
}

/**
 * One `identity` object per distinct name this page addresses.
 *
 * These exist so the set of addressable names can be read without scanning
 * every relation in the space: relations are the space's largest collection
 * (every link, every co-mention, every frontmatter edge), and each tag is its
 * own keyspace in the object index. Keying them by page — which the index does
 * for every object — is also what makes them self-invalidating: re-indexing a
 * page replaces its entries, and deleting it drops them, without anything
 * having to notice that a name stopped being mentioned.
 */
function emitIdentities(ctx: EmitCtx, mentioned: Map<string, string>): void {
  for (const [ref, name] of mentioned) {
    ctx.out.push({
      ref,
      tag: "identity",
      name,
      page: ctx.pageMeta.name,
    } as any);
  }
}

export function isWikiLinkAt(text: string, range: [number, number]): boolean {
  const slice = text.substring(range[0], range[1]);
  return slice.startsWith("[[") || slice.startsWith("![[");
}

async function resolvePageTargets(ctx: EmitCtx, text: string): Promise<void> {
  const candidates = ctx.out.filter(
    (r): r is RelationObject & { range: [number, number] } =>
      r.kind !== "co-mention" && r.toTag === "page" && Array.isArray(r.range),
  );
  if (candidates.length === 0) return;

  const uniqueTargets = [...new Set(candidates.map((r) => r.to))];
  const lookups = await space.lookupPaths(
    uniqueTargets.map((target) => `${target}.md`),
  );
  const index = lookupIndex(lookups);
  const fromPage = `${ctx.pageMeta.name}.md` as Path;

  const resolutions = new Map<string, ResolveResult>();
  const resolutionFor = (target: string, wikiLink: boolean): ResolveResult => {
    const key = `${wikiLink}:${target}`;
    let resolution = resolutions.get(key);
    if (!resolution) {
      const path = `${target}.md` as Path;
      resolution = wikiLink
        ? resolvePath(path, fromPage, index)
        : { path, exists: index.has(path), ambiguous: false };
      resolutions.set(key, resolution);
    }
    return resolution;
  };

  for (const rec of candidates) {
    const resolution = resolutionFor(rec.to, isWikiLinkAt(text, rec.range));

    if (!resolution.exists) {
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
      continue;
    }

    if (resolution.ambiguous) {
      ctx.out.push({
        ref: `${ctx.pageMeta.name}@${rec.range[0]}`,
        tag: "ambiguous-link",
        page: ctx.pageMeta.name,
        pos: rec.range[0],
        range: rec.range,
        name: rec.to,
        resolvesTo: getNameFromPath(resolution.path),
        candidates: (resolution.candidates ?? []).map(getNameFromPath),
      } as any);
    }

    rec.to = getNameFromPath(resolution.path);
  }
}

// For each textual relation with an object target, collect ancestor
// ListItem and Paragraph chains. For each ordered pair sharing an
// ancestor, emit one co-mention edge using the innermost shared scope's
// ref as `via`. ListItem ancestors are preferred over Paragraph.
function emitCoMentions(ctx: EmitCtx, tree: ParseTree): void {
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
    if (!isTextualEdge(rec)) continue;
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
      // at-mentions are excluded: their range covers literal `@nickname`
      // text, which the rename refactor never rewrites.
      where: await lua.parseExpression(
        `_.to == name and _.kind ~= "co-mention" and _.kind ~= "at-mention" and _.toTag ~= "url"`,
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
        lastKey = child.children?.[0]?.text?.trim();
      } else if (child.type === "string" && lastKey) {
        yield { key: lastKey, valueNode: child };
      }
    }
  }
}
