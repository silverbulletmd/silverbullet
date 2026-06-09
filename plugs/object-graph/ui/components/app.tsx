import { datastore, system } from "@silverbulletmd/silverbullet/syscalls";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "preact/hooks";
import type {
	Edge,
	ExpansionResult,
	Filters,
	ForceSettings,
	ObjectNode,
	RootViewModel,
} from "../../src/model.ts";
import { GraphCanvas } from "./graph_canvas.tsx";
import { Header } from "./header.tsx";
import { Sidebar } from "./sidebar.tsx";
import { computeVisible, type NodeState } from "./visibility.ts";

const FILTERS_KEY = ["plug", "object-graph", "filters"];
const FORCES_KEY = ["plug", "object-graph", "forces"];

function edgeKey(e: Edge): string {
	return `${e.source} ${e.target} ${e.label} ${e.kind}`;
}

export function App({ vm }: { vm: RootViewModel }) {
	const [nodes, setNodes] = useState<Map<string, NodeState>>(() => {
		const m = new Map<string, NodeState>();
		const initialStatus: NodeState["status"] = vm.initialAllExpanded
			? "expanded"
			: "ghost";
		m.set(vm.root.object.ref, { node: vm.root.object, status: "expanded" });
		for (const n of vm.root.neighbors) {
			if (!m.has(n.ref)) m.set(n.ref, { node: n, status: initialStatus });
		}
		return m;
	});
	const [edges, setEdges] = useState<Edge[]>(() => [...vm.root.edges]);
	// Derived dedupe index kept in lock-step with `edges`. Lives in a ref
	// (not state) because we mutate it in place and never want it to be a
	// trigger for re-renders.
	const edgeKeysRef = useRef<Set<string>>(new Set(vm.root.edges.map(edgeKey)));
	const [selectedRef, setSelectedRef] = useState<string | null>(
		vm.root.object.ref,
	);
	const [filters, setFilters] = useState<Filters>(vm.filters);
	const [sidebarWidth, setSidebarWidth] = useState<number>(230);
	const [forces, setForces] = useState<ForceSettings>(vm.forces);
	const [cache] = useState<Map<string, ExpansionResult>>(() => {
		const m = new Map<string, ExpansionResult>();
		m.set(vm.root.object.ref, vm.root);
		return m;
	});

	// Persist filters whenever they change. Disabled for transient modes
	// (e.g. the global view) so they don't trample the local view's saved
	// preferences. Skip the initial mount — those values came FROM the
	// datastore (or the view's preset) and writing them back is pointless.
	const persistFilters = vm.persistFilters !== false;
	const didMountRef = useRef(false);
	useEffect(() => {
		if (!persistFilters) return;
		if (!didMountRef.current) {
			didMountRef.current = true;
			return;
		}
		void datastore.set(FILTERS_KEY, filters);
	}, [filters, persistFilters]);

	// Forces persist regardless of view (global and explore share them).
	const didMountForcesRef = useRef(false);
	useEffect(() => {
		if (!didMountForcesRef.current) {
			didMountForcesRef.current = true;
			return;
		}
		void datastore.set(FORCES_KEY, forces);
	}, [forces]);

	const fetchExpansion = useCallback(
		async (ref: string): Promise<ExpansionResult> => {
			const cached = cache.get(ref);
			if (cached) return cached;
			const result = (await system.invokeFunction(
				"object-graph.expandObject",
				ref,
			)) as ExpansionResult;
			cache.set(ref, result);
			return result;
		},
		[cache],
	);

	const applyExpansions = useCallback((results: ExpansionResult[]) => {
		if (results.length === 0) return;
		setNodes((prev) => {
			const next = new Map(prev);
			for (const r of results) {
				next.set(r.object.ref, { node: r.object, status: "expanded" });
				for (const n of r.neighbors) {
					if (!next.has(n.ref)) next.set(n.ref, { node: n, status: "ghost" });
				}
			}
			return next;
		});
		setEdges((prev) => {
			const additions: Edge[] = [];
			const keys = edgeKeysRef.current;
			for (const r of results) {
				for (const e of r.edges) {
					const k = edgeKey(e);
					if (!keys.has(k)) {
						keys.add(k);
						additions.push(e);
					}
				}
			}
			return additions.length ? [...prev, ...additions] : prev;
		});
	}, []);

	const expandRef = useCallback(
		async (ref: string) => {
			applyExpansions([await fetchExpansion(ref)]);
		},
		[applyExpansions, fetchExpansion],
	);

	const onNodeClick = useCallback(
		(ref: string) => {
			const state = nodes.get(ref);
			setSelectedRef(ref);
			if (state && state.status === "ghost") {
				void expandRef(ref);
			}
		},
		[nodes, expandRef],
	);

	const removeNode = useCallback((ref: string) => {
		setNodes((prev) => {
			if (!prev.has(ref)) return prev;
			const next = new Map(prev);
			next.delete(ref);
			return next;
		});
		setEdges((prev) => {
			const remaining: Edge[] = [];
			const keys = edgeKeysRef.current;
			for (const e of prev) {
				if (e.source === ref || e.target === ref) {
					keys.delete(edgeKey(e));
					continue;
				}
				remaining.push(e);
			}
			return remaining.length === prev.length ? prev : remaining;
		});
		setSelectedRef((sel) => (sel === ref ? null : sel));
	}, []);

	const selected: ObjectNode | null = selectedRef
		? (nodes.get(selectedRef)?.node ?? null)
		: null;

	// Stable ref to the current visibleNodes so callbacks always see the latest
	// set without forcing the callback identity to churn on every filter tweak.
	const visibleNodesRef = useRef<NodeState[]>([]);

	// Transitive expansion: follow every relation outward, round by round,
	// until no new ghosts remain along allowed labels. Hidden-label edges
	// are recorded (so toggling them on later reveals them) but they
	// don't seed further exploration. Safety-capped at 5000 nodes.
	const expandAllVisibleGhosts = useCallback(async () => {
		const SAFETY_CAP = 5000;
		const hiddenLabels = new Set(filters.hiddenLabels);
		const expanded = new Set<string>();
		const pending = new Set<string>();
		for (const ns of visibleNodesRef.current) {
			if (ns.status === "expanded") expanded.add(ns.node.ref);
			else pending.add(ns.node.ref);
		}
		while (pending.size > 0) {
			if (expanded.size + pending.size > SAFETY_CAP) break;
			const refs = [...pending];
			pending.clear();
			const results = await Promise.all(refs.map(fetchExpansion));
			applyExpansions(results);
			for (const r of results) {
				expanded.add(r.object.ref);
				// Only follow edges whose label is currently visible.
				for (const e of r.edges) {
					if (hiddenLabels.has(e.label)) continue;
					for (const ref of [e.source, e.target]) {
						if (!expanded.has(ref) && !pending.has(ref)) pending.add(ref);
					}
				}
			}
		}
	}, [fetchExpansion, applyExpansions, filters.hiddenLabels]);

	/**
	 * Reset the explored set to "currently-selected object + its 1-hop
	 * ghosts". The selection stays put; only the broader exploration is
	 * collapsed back to that node's immediate neighborhood.
	 *
	 * Always issues a fresh worker call (skipping the cache) because the
	 * cache may hold a wide expansion for this ref — notably, in the
	 * Global Page Map view the cache entry for the anchor IS the global
	 * graph, and returning that here would defeat the whole point of Focus.
	 */
	const collapseAll = useCallback(async () => {
		const anchor = selectedRef ?? vm.root.object.ref;
		const result = (await system.invokeFunction(
			"object-graph.expandObject",
			anchor,
		)) as ExpansionResult;
		cache.set(anchor, result);
		const m = new Map<string, NodeState>();
		m.set(result.object.ref, { node: result.object, status: "expanded" });
		for (const n of result.neighbors) {
			if (!m.has(n.ref)) m.set(n.ref, { node: n, status: "ghost" });
		}
		setNodes(m);
		setEdges([...result.edges]);
		const keys = edgeKeysRef.current;
		keys.clear();
		for (const e of result.edges) keys.add(edgeKey(e));
		setSelectedRef(result.object.ref);
	}, [selectedRef, cache, vm.root.object.ref]);

	// Keyboard: Backspace / Delete removes selected, unless focused in an input.
	useEffect(() => {
		const handler = (ev: KeyboardEvent) => {
			if (ev.key !== "Backspace" && ev.key !== "Delete") return;
			const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
			if (tag === "input" || tag === "textarea" || tag === "select") return;
			if (!selectedRef) return;
			ev.preventDefault();
			removeNode(selectedRef);
		};
		globalThis.addEventListener("keydown", handler);
		return () => globalThis.removeEventListener("keydown", handler);
	}, [selectedRef, removeNode]);

	// Visible subgraph (view-layer only). Filter rules:
	//   • The root is always visible — it's the user's anchor into the graph.
	//   • Every other node (expanded or ghost) must pass the tag filter.
	//   • Edges must pass the label filter and connect two visible nodes.
	//   • A ghost that has no remaining edges to a visible neighbor is
	//     hidden — otherwise unchecking an edge label leaves orphan ghosts
	//     floating with no visible reason to be there.
	const rootRef = vm.root.object.ref;
	const { visibleNodes, visibleEdges } = useMemo(
		() => computeVisible(nodes.values(), edges, filters, rootRef),
		[nodes, edges, filters, rootRef],
	);

	// Keep the ref in sync so expandAllVisibleGhosts sees the latest set.
	visibleNodesRef.current = visibleNodes;

	const ghostCount = visibleNodes.reduce(
		(a, ns) => a + (ns.status === "ghost" ? 1 : 0),
		0,
	);

	// Stable arrays for the sidebar's tally inputs (the underlying state
	// changes only when nodes/edges actually change; without these, every
	// App render would produce fresh array identities and re-tally everything).
	const allObjectNodes = useMemo(
		() => [...nodes.values()].map((ns) => ns.node),
		[nodes],
	);
	const visibleObjectNodes = useMemo(
		() => visibleNodes.map((ns) => ns.node),
		[visibleNodes],
	);

	return (
		<div class="gv-app">
			<Header
				ghostCount={ghostCount}
				onExpandAll={expandAllVisibleGhosts}
				onCollapseAll={collapseAll}
				hideEdgeLabels={filters.hideEdgeLabels}
				onToggleHideEdgeLabels={(v) =>
					setFilters({ ...filters, hideEdgeLabels: v })
				}
				hideOrphans={filters.hideOrphans}
				onToggleHideOrphans={(v) => setFilters({ ...filters, hideOrphans: v })}
			/>
			<div
				class="gv-body"
				style={{ "--gv-sidebar-width": `${sidebarWidth}px` }}
			>
				<Sidebar
					nodes={visibleObjectNodes}
					edges={visibleEdges}
					allNodes={allObjectNodes}
					allEdges={edges}
					universe={vm.universe}
					filters={filters}
					onFiltersChange={setFilters}
					forces={forces}
					onForcesChange={setForces}
					selected={selected}
				/>
				<SidebarResizer width={sidebarWidth} onResize={setSidebarWidth} />
				<GraphCanvas
					nodes={visibleNodes}
					edges={visibleEdges}
					selectedRef={selectedRef}
					onNodeClick={onNodeClick}
					hideEdgeLabels={filters.hideEdgeLabels}
					forces={forces}
				/>
			</div>
		</div>
	);
}

const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 600;

function SidebarResizer({
	width,
	onResize,
}: {
	width: number;
	onResize: (w: number) => void;
}) {
	const [dragging, setDragging] = useState(false);
	const startRef = useRef<{ x: number; w: number } | null>(null);

	useEffect(() => {
		if (!dragging) return;
		const onMove = (e: MouseEvent) => {
			const start = startRef.current;
			if (!start) return;
			const next = Math.min(
				MAX_SIDEBAR_WIDTH,
				Math.max(MIN_SIDEBAR_WIDTH, start.w + (e.clientX - start.x)),
			);
			onResize(next);
		};
		const onUp = () => setDragging(false);
		globalThis.addEventListener("mousemove", onMove);
		globalThis.addEventListener("mouseup", onUp);
		return () => {
			globalThis.removeEventListener("mousemove", onMove);
			globalThis.removeEventListener("mouseup", onUp);
		};
	}, [dragging, onResize]);

	return (
		<div
			class={`gv-resizer${dragging ? " dragging" : ""}`}
			onMouseDown={(e) => {
				startRef.current = { x: e.clientX, w: width };
				setDragging(true);
				e.preventDefault();
			}}
		/>
	);
}
