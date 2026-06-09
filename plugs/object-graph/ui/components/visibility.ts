import type { Edge, Filters, ObjectNode } from "../../src/model.ts";

export type NodeState = { node: ObjectNode; status: "expanded" | "ghost" };

export type VisibilityResult = {
	visibleNodes: NodeState[];
	visibleEdges: Edge[];
};

// Pure derivation of what the panel paints from the explored-graph state.
// Three stages:
//   1. candidate = nodes that pass the tag filter (root is always a candidate).
//   2. labeledEdges = edges with a visible label that connect two candidates.
//   3. orphan rule: with `hideOrphans` on, any candidate other than the root
//      is dropped if it has no labeledEdge incidence.
export function computeVisible(
	nodes: Iterable<NodeState>,
	edges: Edge[],
	filters: Filters,
	rootRef: string,
): VisibilityResult {
	function passesTags(n: ObjectNode): boolean {
		if (n.ref === rootRef) return true;
		if (n.tags.length === 0) return !filters.hiddenTags.includes("(untagged)");
		return n.tags.some((t) => !filters.hiddenTags.includes(t));
	}

	const candidate = new Set<string>();
	const nodeList: NodeState[] = [];
	for (const ns of nodes) {
		nodeList.push(ns);
		if (passesTags(ns.node)) candidate.add(ns.node.ref);
	}

	const labeledEdges = edges.filter(
		(e) =>
			candidate.has(e.source) &&
			candidate.has(e.target) &&
			!filters.hiddenLabels.includes(e.label),
	);

	const degree = new Map<string, number>();
	for (const e of labeledEdges) {
		degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
		degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
	}

	const out: NodeState[] = [];
	const hideOrphans = filters.hideOrphans;
	for (const ns of nodeList) {
		if (!candidate.has(ns.node.ref)) continue;
		if (
			!hideOrphans ||
			ns.node.ref === rootRef ||
			(degree.get(ns.node.ref) ?? 0) > 0
		) {
			out.push(ns);
		}
	}

	const visibleRefSet = new Set(out.map((ns) => ns.node.ref));
	const visibleEdges = labeledEdges.filter(
		(e) => visibleRefSet.has(e.source) && visibleRefSet.has(e.target),
	);

	return { visibleNodes: out, visibleEdges };
}
