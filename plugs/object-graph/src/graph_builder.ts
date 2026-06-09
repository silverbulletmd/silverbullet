import { index, lua } from "@silverbulletmd/silverbullet/syscalls";
import type {
	Edge,
	EdgeProvenance,
	ExpansionResult,
	GraphUniverse,
	ObjectKind,
	ObjectNode,
} from "./model.ts";

/**
 * Core tags published by SilverBullet's indexer. These are NEVER shown in
 * the "Tags" sidebar (which is reserved for user tags); they appear in the
 * "Root tags" sidebar instead, and a single one is stored as each node's
 * `rootTag`.
 */
const CORE_TAGS = new Set([
	"page",
	"item",
	"task",
	"header",
	"paragraph",
	"block",
	"meta",
	"aspiring-page",
	"document",
	"url",
]);

export function isCoreTag(t: string): boolean {
	return CORE_TAGS.has(t) || t.startsWith("meta/");
}

export type RelationRow = {
	from: string;
	to: string;
	fromTag?: string;
	toTag?: string;
	kind: string;
	via?: string;
	page: string;
	range?: [number, number];
	snippet?: string;
};

type IndexedObject = {
	ref?: string;
	name?: string;
	tag?: string;
	tags?: string[];
	pageDecoration?: { prefix?: string };
	[k: string]: unknown;
};

/**
 * Strip positional / header / anchor suffixes from a page-style ref so a
 * link to `Page@744` (or `Page#header`, `Page$anchor`) lands on the bare
 * `Page` node. URL / file refs are untouched.
 */
export function stripPagePos(ref: string): string {
	if (classifyKind(ref) !== "page") return ref;
	return ref.split(/[@#$]/)[0] || ref;
}

/**
 * Graph cache populated lazily on the first call and reused across every
 * subsequent `expandObject` / `buildGlobalGraph` round-trip the panel makes.
 * SilverBullet's `index.queryLuaObjects`  isn't cheap; one bulk pull + in-memory filter is much faster overall than
 * a per-ref query for every expansion. The cache is cleared by
 * `invalidateGraphCache()` at the start of each top-level command so a
 * freshly opened modal sees fresh data.
 */
type GraphCache = {
	relations: RelationRow[];
	pagesByName: Map<string, IndexedObject>;
};
let cache: GraphCache | null = null;

export function invalidateGraphCache(): void {
	cache = null;
}

async function ensureCache(): Promise<GraphCache> {
	if (cache) return cache;
	const [relations, pages] = (await Promise.all([
		index.queryLuaObjects<RelationRow>("relation", { objectVariable: "r" }),
		index.queryLuaObjects<IndexedObject>("page", { objectVariable: "p" }),
	])) as [RelationRow[], IndexedObject[]];
	const pagesByName = new Map<string, IndexedObject>();
	for (const p of pages) {
		const name = String(p.name ?? "");
		if (name) pagesByName.set(name, p);
	}
	cache = { relations, pagesByName };
	return cache;
}

/**
 * Match an edge endpoint against a bare ref, including positional /
 * header / anchor variants (`Page@123`, `Page#header`, `Page$anchor`).
 */
export function endpointMatchesRef(endpoint: string, ref: string): boolean {
	if (endpoint === ref) return true;
	if (!endpoint.startsWith(ref)) return false;
	const c = endpoint.charAt(ref.length);
	return c === "@" || c === "#" || c === "$";
}

async function queryRelations(ref: string): Promise<RelationRow[]> {
	const { relations } = await ensureCache();
	return relations.filter(
		(r) => endpointMatchesRef(r.from, ref) || endpointMatchesRef(r.to, ref),
	);
}

/**
 * Collapse co-mention pairs in opposite directions sharing the same `via`
 * into a single undirected edge. Other parallel edges (different `kind`)
 * remain distinct.
 */
export function collapseEdges(rows: RelationRow[]): Edge[] {
	const out: Edge[] = [];
	const seenCoMention = new Map<string, number>(); // key -> out index

	for (const r of rows) {
		const label = r.kind;
		const prov: EdgeProvenance = {
			page: r.page,
			pos: r.range?.[0],
			snippet: r.snippet,
		};

		if (r.kind === "co-mention") {
			const k = [r.from, r.to, r.via ?? ""].sort().join(" ");
			const existing = seenCoMention.get(k);
			if (existing !== undefined) {
				out[existing].refs.push(prov);
				out[existing].undirected = true;
				continue;
			}
			seenCoMention.set(k, out.length);
			out.push({
				source: r.from,
				target: r.to,
				label,
				kind: r.kind,
				refs: [prov],
				undirected: false, // becomes true when the reverse pair lands
			});
			continue;
		}

		out.push({
			source: r.from,
			target: r.to,
			label,
			kind: r.kind,
			refs: [prov],
			undirected: false,
		});
	}

	return out;
}

/**
 * Resolve a ref to an indexed object. Pages are served instantly from the
 * in-memory cache (the common case). Items and blocks fall back to a
 * single targeted query each — they're rare as relation endpoints, so
 * pre-loading all of them would cost more than the occasional miss.
 */
async function findIndexed(
	ref: string,
): Promise<{ tag: string; obj: IndexedObject } | null> {
	const { pagesByName } = await ensureCache();
	const page = pagesByName.get(ref);
	if (page) return { tag: "page", obj: page };
	const byRefExpr = await lua.parseExpression("o.ref == ref");
	const queryFor = (tag: string) =>
		index.queryLuaObjects<IndexedObject>(
			tag,
			{ objectVariable: "o", where: byRefExpr },
			{ ref },
		) as Promise<IndexedObject[]>;
	const [items, blocks] = await Promise.all([
		queryFor("item"),
		queryFor("block"),
	]);
	if (items.length) return { tag: "item", obj: items[0] };
	if (blocks.length) return { tag: "block", obj: blocks[0] };
	return null;
}

export function classifyKind(ref: string): ObjectKind {
	if (/^https?:\/\//.test(ref)) return "url";
	if (/^[^/]+\.[^/]+$/.test(ref) && !ref.endsWith(".md")) return "file";
	return "page";
}

function deriveTitle(
	ref: string,
	kind: ObjectKind,
	obj: IndexedObject | null,
): string {
	if (obj?.name) return String(obj.name);
	if (kind === "url" || kind === "file") return ref.split(/[\\/]/).pop() ?? ref;
	return ref;
}

export function deriveTagFields(
	allTags: string[],
	hostTag: string,
): {
	rootTag: string | null;
	primaryTag: string | null;
	tags: string[];
} {
	// `hostTag` is the structural tag the indexer keyed on (page/item/block).
	// SilverBullet's indexer also exposes additional user tags via `tags`.
	const hasTask = allTags.includes("task");
	let rootTag: string | null;
	if (hostTag === "item" && hasTask) rootTag = "task";
	else if (CORE_TAGS.has(hostTag)) rootTag = hostTag;
	else rootTag = null;

	const userTags = allTags.filter((t) => !isCoreTag(t));
	return {
		rootTag,
		primaryTag: userTags[0] ?? null,
		tags: userTags,
	};
}

// Project an already-fetched indexed object into the panel's ObjectNode shape.
function projectIndexed(
	ref: string,
	structuralTag: string,
	obj: IndexedObject,
): ObjectNode {
	const tagsField = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
	const allTags = tagsField.includes(structuralTag)
		? tagsField
		: [structuralTag, ...tagsField];
	const { rootTag, primaryTag, tags } = deriveTagFields(allTags, structuralTag);
	const kind: ObjectKind =
		structuralTag === "page"
			? "page"
			: structuralTag === "item" || structuralTag === "task"
				? "item"
				: "block";
	return {
		ref,
		kind,
		title: deriveTitle(ref, kind, obj),
		rootTag,
		primaryTag,
		tags,
		dangling: false,
		prefix: obj.pageDecoration?.prefix,
		attributes: obj as Record<string, unknown>,
	};
}

function stubNode(
	ref: string,
	kind: ObjectKind,
	dangling: boolean,
): ObjectNode {
	return {
		ref,
		kind,
		title: deriveTitle(ref, kind, null),
		rootTag: null,
		primaryTag: null,
		tags: [],
		dangling,
		attributes: { ref, ...(dangling ? { dangling: true } : {}) },
	};
}

async function resolveObject(ref: string): Promise<ObjectNode> {
	const kindHint = classifyKind(ref);
	if (kindHint === "url" || kindHint === "file") {
		return stubNode(ref, kindHint, false);
	}
	const found = await findIndexed(ref);
	if (!found) return stubNode(ref, "page", true);
	return projectIndexed(ref, found.tag, found.obj);
}

export async function expandObject(ref: string): Promise<ExpansionResult> {
	const normRef = stripPagePos(ref);
	const rows = await queryRelations(normRef);
	// Normalize endpoints so positional variants (`Page@123`) collapse to the
	// bare page ref across the whole object graph.
	const edges = collapseEdges(rows).map((e) => ({
		...e,
		source: stripPagePos(e.source),
		target: stripPagePos(e.target),
	}));

	const neighborRefs = new Set<string>();
	for (const e of edges) {
		if (e.source !== normRef) neighborRefs.add(e.source);
		if (e.target !== normRef) neighborRefs.add(e.target);
	}

	const [object, neighbors] = await Promise.all([
		resolveObject(normRef),
		Promise.all([...neighborRefs].map(resolveObject)),
	]);

	return { object, neighbors, edges };
}

/**
 * Build the data for the global view: every page + every relation in the
 * space. The caller is expected to default the label filter to "mention
 * only" — but the data is here so the user can toggle other labels on
 * without a refetch. `rootRef` picks the anchor (current page if available).
 */
export async function buildGlobalGraph(
	rootRef: string | null,
): Promise<ExpansionResult | null> {
	const { relations, pagesByName } = await ensureCache();
	const allPages = [...pagesByName.values()];
	// Equivalent of `index.contentPages()`: drop meta-tagged pages.
	const isMeta = (p: IndexedObject) => {
		const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
		return tags.some((t) => t === "meta" || t.startsWith("meta/"));
	};
	const pages = allPages.filter((p) => !isMeta(p));
	const metaRefs = new Set(
		allPages.filter(isMeta).map((p) => String(p.name ?? "")),
	);
	if (pages.length === 0) return null;
	const rows = relations;

	const nodeByRef = new Map<string, ObjectNode>();
	for (const p of pages) {
		const ref = String(p.name ?? p.ref ?? "");
		if (!ref) continue;
		nodeByRef.set(ref, projectIndexed(ref, "page", p));
	}

	// Drop edges that touch meta pages, and constrain the global view to
	// page-to-page edges only: URL / file / item / block endpoints are
	// out of scope here. They'd otherwise drag in non-page nodes (random
	// URLs and so on) that the Global Page Map promises not to show.
	const edges = collapseEdges(rows)
		.map((e) => ({
			...e,
			source: stripPagePos(e.source),
			target: stripPagePos(e.target),
		}))
		.filter(
			(e) =>
				!metaRefs.has(e.source) &&
				!metaRefs.has(e.target) &&
				nodeByRef.has(e.source) &&
				nodeByRef.has(e.target),
		);

	// Choose the root: prefer the caller-supplied ref when available;
	// otherwise pick an arbitrary page (first by name).
	const anchor =
		rootRef && nodeByRef.has(rootRef)
			? rootRef
			: [...nodeByRef.keys()].sort()[0];
	const object = nodeByRef.get(anchor)!;
	const neighbors = [...nodeByRef.values()].filter((n) => n.ref !== anchor);

	return { object, neighbors, edges };
}

/**
 * Distinct root tags, user tags, and relation labels present in the space.
 * Drives the sidebar's option lists so checkboxes show every value the
 * user might want to toggle, not just what's in the current explored set.
 */
export async function buildUniverse(): Promise<GraphUniverse> {
	const { relations, pagesByName } = await ensureCache();

	// User tags: every non-core tag attached to any page in the space.
	const tagSet = new Set<string>();
	for (const p of pagesByName.values()) {
		const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
		for (const t of tags) {
			if (isCoreTag(t)) continue;
			tagSet.add(t);
		}
	}
	const tags = [...tagSet].sort();

	// Relation labels: distinct `kind` across all relations.
	const labelSet = new Set<string>();
	for (const r of relations) labelSet.add(r.kind);
	const labels = [...labelSet].sort();

	return { tags, labels };
}
