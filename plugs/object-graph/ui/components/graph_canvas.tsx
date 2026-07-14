import { editor } from "@silverbulletmd/silverbullet/syscalls";
import * as d3 from "d3-force";
import ForceGraphImpl from "force-graph";
import { Component } from "preact";
import type { Edge, ForceSettings, ObjectNode } from "../../src/model.ts";
import { STRUCTURAL_KINDS } from "../../src/model.ts";
import { colorForTag } from "../colors.ts";

// All four force parameters are now driven by sliders in the sidebar;
// see ForceSettings in src/model.ts for the defaults.
const CLICK_DELAY_MS = 220;
// Upper bound for the auto-fit camera scale. Prevents zoomToFit from
// magnifying a single isolated node to fill the entire canvas.
const MAX_AUTO_ZOOM = 4;

// Tick budgets before the simulation cools and we auto-fit the camera (via
// onEngineStop → recenter). Fitting on a fixed timer fit mid-layout and left
// nodes half off-screen; fitting on settle is reliable. A from-scratch first
// layout needs more settling than an incremental expansion.
const FIRST_FIT_COOLDOWN_TICKS = 140;
const REFIT_COOLDOWN_TICKS = 60;

type NodeStatus = "expanded" | "ghost";

type Props = {
  nodes: { node: ObjectNode; status: NodeStatus }[];
  edges: Edge[];
  selectedRef: string | null;
  onNodeClick: (ref: string) => void;
  hideEdgeLabels: boolean;
  forces: ForceSettings;
};

type FGNode = {
  id: string;
  node: ObjectNode;
  status: NodeStatus;
  kind: ObjectNode["kind"];
  dangling: boolean;
  title: string;
  prefix?: string;
  degree: number;
  color: string;
  x?: number;
  y?: number;
  // Pin coordinates set on drag. Kept as `number` (never null) so FGNode
  // satisfies both force-graph's `NodeObject` and d3's `SimulationNodeDatum`.
  fx?: number;
  fy?: number;
};

// Panel-side merged edge — collapses parallel edges between the same pair
// of nodes (regardless of direction) into one record. `bidirectional` is
// set when at least one of the merged inputs ran the reverse direction.
type MergedEdge = Edge & { bidirectional: boolean };

type FGLink = {
  source: string | FGNode;
  target: string | FGNode;
  edge: MergedEdge;
};

// force-graph 1.51 ships class-style typings (`new ForceGraph(el)`), but the
// runtime default export is still the Kapsule factory invoked as
// `ForceGraph()(element)`. Bridge the two: keep the chainable instance type
// (parameterized with our own node/link shapes so the accessor callbacks
// below type-check) while treating the import as the runtime factory.
type ForceGraphInstance = ForceGraphImpl<FGNode, FGLink>;
const ForceGraph = ForceGraphImpl as unknown as () => (
  element: HTMLElement,
) => ForceGraphInstance;

type Theme = {
  bg: string;
  nodeDim: string;
  label: string;
  labelDim: string;
  labelHalo: string;
  link: string;
  linkDim: string;
  linkHot: string;
  accent: string;
};

type State = {
  edgeHover: { edge: MergedEdge; x: number; y: number } | null;
  ghostHover: { title: string; x: number; y: number } | null;
};

type ComputedGraph = {
  nodes: FGNode[];
  links: FGLink[];
  adjacency: Map<string, Set<string>>;
  radii: Map<string, number>;
};

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fallback: string) =>
    cs.getPropertyValue(n).trim() || fallback;
  return {
    bg: v("--gv-bg", "#ffffff"),
    nodeDim: v("--gv-node-dim", "#9e4705"),
    label: v("--gv-label", "#333"),
    labelDim: v("--gv-label-dim", "#676767"),
    labelHalo: v("--gv-label-halo", "rgba(255,255,255,0.78)"),
    link: v("--gv-link", "#c8c8c8"),
    linkDim: v("--gv-link-dim", "#e6e6e6"),
    linkHot: v("--gv-link-hot", "#464cfc"),
    accent: v("--gv-accent", "#650007"),
  };
}

function getId(end: string | FGNode): string {
  return typeof end === "string" ? end : end.id;
}

function nodeRadius(degree: number): number {
  // Modest growth with degree. Hubs go a bit larger but stay readable.
  return 6 + Math.min(degree, 10) * 0.5;
}

// Strip directory prefix; show just the last path segment for graph labels.
function displayName(title: string): string {
  const i = title.lastIndexOf("/");
  return i === -1 ? title : title.slice(i + 1);
}

// Label visibility thresholds expressed in zoom (graph→screen) scale.
const NODE_LABEL_MIN_SCALE = 0.6;
const EDGE_LABEL_MIN_SCALE = 1.8;

function computeGraph(
  inputNodes: Props["nodes"],
  edges: Edge[],
): ComputedGraph {
  const degree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  for (const ns of inputNodes) {
    degree.set(ns.node.ref, 0);
    adj.set(ns.node.ref, new Set());
  }
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  const fgNodes: FGNode[] = inputNodes.map(({ node, status }) => ({
    id: node.ref,
    node,
    status,
    kind: node.kind,
    dangling: node.dangling,
    title: node.title,
    prefix: node.prefix,
    degree: degree.get(node.ref) ?? 0,
    color: colorForTag(node.primaryTag),
  }));
  // Merge all edges between the same pair of nodes (unordered) into a
  // single visual edge with a comma-joined label, combined provenance,
  // and a `bidirectional` flag when both directions were present.
  type Accum = MergedEdge & { labels: Set<string> };
  const merged = new Map<string, Accum>();
  for (const e of edges) {
    const [a, b] =
      e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${a}\x00${b}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...e,
        refs: [...e.refs],
        labels: new Set([e.label]),
        bidirectional: false,
      });
      continue;
    }
    existing.labels.add(e.label);
    existing.refs.push(...e.refs);
    if (e.undirected) existing.undirected = true;
    if (e.source !== existing.source) existing.bidirectional = true;
    // Non-mention kinds beat `mention` for styling purposes.
    if (existing.kind === "mention" && e.kind !== "mention") {
      existing.kind = e.kind;
    }
  }
  const fgLinks: FGLink[] = [...merged.values()].map((acc) => {
    const { labels, ...edge } = acc;
    edge.label = [...labels].join(", ");
    return { source: edge.source, target: edge.target, edge };
  });
  const rmap = new Map<string, number>();
  for (const n of fgNodes) rmap.set(n.id, nodeRadius(n.degree));
  return {
    nodes: fgNodes,
    links: fgLinks,
    adjacency: adj,
    radii: rmap,
  };
}

export class GraphCanvas extends Component<Props, State> {
  state: State = { edgeHover: null, ghostHover: null };

  // DOM + force-graph handles.
  private containerRef: HTMLDivElement | null = null;
  private fg: ForceGraphInstance | null = null;

  // Hover/adjacency state read by draw callbacks every frame.
  private hoveredId: string | null = null;
  private neighbors: Set<string> = new Set();
  private adjacency: Map<string, Set<string>> = new Map();
  private theme: Theme = readTheme();
  private radiusMap: Map<string, number> = new Map();

  // Mouse position relative to the canvas container; drives the edge tooltip.
  private mousePos: { x: number; y: number } = { x: 0, y: 0 };

  // Click-cancel timers for distinguishing single vs. double click.
  private clickTimer: number | null = null;
  private edgeClickTimer: number | null = null;

  // Whether we've fed data once already. Both the first feed and later ones
  // (expansions/collapses) arm `pendingFit` and auto-fit once the simulation
  // settles (see onEngineStop); only the cooldown budget differs.
  private fedOnce = false;

  // Set when a data-driven feed wants the camera re-fitted after the
  // simulation next settles. Gated so node drags (which also re-heat and
  // fire onEngineStop) don't trigger camera jumps.
  private pendingFit = false;

  // Cached computation of nodes/links/adjacency/radii; recomputed in
  // componentDidUpdate when props.nodes or props.edges identity changes.
  private computed: ComputedGraph;

  // Listeners/observers we own and must tear down.
  private resizeObserver: ResizeObserver | null = null;
  private mql: MediaQueryList | null = null;

  constructor(props: Props) {
    super(props);
    this.computed = computeGraph(props.nodes, props.edges);
    // Bind handlers used as listener references / bare JSX onClicks so
    // `this` resolves correctly and identities stay stable across
    // add/removeEventListener pairs.
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onThemeChange = this.onThemeChange.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.zoomIn = this.zoomIn.bind(this);
    this.zoomOut = this.zoomOut.bind(this);
    this.pan = this.pan.bind(this);
    this.recenter = this.recenter.bind(this);
  }

  private onMouseMove(ev: MouseEvent) {
    if (!this.containerRef) return;
    const rect = this.containerRef.getBoundingClientRect();
    this.mousePos = {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
    };
  }

  private onThemeChange() {
    this.theme = readTheme();
    this.rerender();
  }

  private onKeyDown(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement | null;
    if (
      tgt &&
      (tgt.tagName === "INPUT" ||
        tgt.tagName === "TEXTAREA" ||
        (tgt as HTMLElement).isContentEditable)
    )
      return;

    switch (e.key) {
      case "ArrowUp":
        this.pan(0, -1);
        break;
      case "ArrowDown":
        this.pan(0, 1);
        break;
      case "ArrowLeft":
        this.pan(-1, 0);
        break;
      case "ArrowRight":
        this.pan(1, 0);
        break;
      case "PageUp":
      case "+":
      case "=":
        this.zoomIn();
        break;
      case "PageDown":
      case "-":
      case "_":
        this.zoomOut();
        break;
      case "f":
      case "F":
        this.recenter();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // Configure the link force's strength + distance accessors. The link
  // set itself is owned by force-graph (rebound from graphData on every
  // update), so we only set the per-link knobs. Multi-edge pairs get a
  // proportionally stronger spring for Obsidian-style cluster pull.
  private configureLinkForce() {
    const fg = this.fg;
    if (!fg) return;
    const f = this.props.forces;
    const linkForce = fg.d3Force("link") as d3.ForceLink<FGNode, FGLink> | null;
    if (!linkForce) return;
    const mult = (l: FGLink) => Math.min(l.edge.refs.length, 6);
    linkForce.strength((l: FGLink) => f.linkStrength * mult(l));
    linkForce.distance(f.linkDistance);
  }

  private applyForces() {
    const fg = this.fg;
    if (!fg) return;
    const f = this.props.forces;
    const centerStrength = (n: FGNode) =>
      n.degree === 0 ? f.centerStrength * 6 : f.centerStrength;
    (fg.d3Force("x") as d3.ForceX<FGNode> | null)?.strength(centerStrength);
    (fg.d3Force("y") as d3.ForceY<FGNode> | null)?.strength(centerStrength);
    (fg.d3Force("charge") as d3.ForceManyBody<FGNode> | null)?.strength(
      f.chargeStrength,
    );
    this.configureLinkForce();
    // Re-heat softly so the new force field has a chance to settle.
    fg.d3ReheatSimulation();
  }

  componentDidMount() {
    if (!this.containerRef) return;
    const fg = ForceGraph()(this.containerRef);
    this.fg = fg;

    fg.backgroundColor("transparent")
      .nodeId("id")
      .nodeCanvasObjectMode(() => "replace")
      .nodeCanvasObject(
        (node: FGNode, ctx: CanvasRenderingContext2D, scale: number) =>
          this.drawNode(node, ctx, scale),
      )
      .nodePointerAreaPaint(
        (node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          const r = (this.radiusMap.get(node.id) ?? 12) + 4;
          ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fill();
        },
      )
      .linkCanvasObjectMode(() => "replace")
      .linkCanvasObject(
        (link: FGLink, ctx: CanvasRenderingContext2D, scale: number) =>
          this.drawLink(link, ctx, scale),
      )
      .onNodeHover((node: FGNode | null) => {
        const id = node?.id ?? null;
        this.hoveredId = id;
        this.neighbors = id ? (this.adjacency.get(id) ?? new Set()) : new Set();
        if (node && node.status === "ghost") {
          this.setState({
            ghostHover: {
              title: node.title,
              x: this.mousePos.x,
              y: this.mousePos.y,
            },
          });
        } else if (this.state.ghostHover) {
          this.setState({ ghostHover: null });
        }
        this.rerender();
      })
      .onNodeClick((node: FGNode) => this.handleNodeClick(node))
      .onLinkHover((link: FGLink | null) => {
        if (!link) {
          this.setState({ edgeHover: null });
          return;
        }
        this.setState({
          edgeHover: {
            edge: link.edge,
            x: this.mousePos.x,
            y: this.mousePos.y,
          },
        });
      })
      .onLinkClick((link: FGLink) => this.handleLinkClick(link))
      .onNodeDrag((node: FGNode) => {
        // Pin node where it's dragged.
        node.fx = node.x;
        node.fy = node.y;
      })
      .onNodeDragEnd((node: FGNode) => {
        node.fx = node.x;
        node.fy = node.y;
      })
      .onEngineStop(() => {
        // After a data-driven feed re-heats the simulation and it settles,
        // re-fit the camera so newly added/removed nodes stay in view.
        // Gated by pendingFit so drag-induced settles don't move the camera.
        if (this.pendingFit) {
          this.pendingFit = false;
          this.recenter();
        }
      });

    const f = this.props.forces;
    // Center pull, degree-aware: isolated nodes (degree 0) get a much
    // stronger pull so they don't drift off into the void; well-connected
    // nodes use the slider's base strength so clusters can still spread.
    const centerStrength = (n: FGNode) =>
      n.degree === 0 ? f.centerStrength * 6 : f.centerStrength;
    fg.d3Force("x", d3.forceX<FGNode>(0).strength(centerStrength));
    fg.d3Force("y", d3.forceY<FGNode>(0).strength(centerStrength));
    // Generous collide padding so node labels (rendered below each node)
    // have room to breathe and don't overlap with neighbors.
    fg.d3Force(
      "collide",
      d3
        .forceCollide<FGNode>((n) => (this.radiusMap.get(n.id) ?? 12) + 16)
        .strength(0.85),
    );
    (fg.d3Force("charge") as d3.ForceManyBody<any> | null)?.strength(
      f.chargeStrength,
    );
    // Force-graph maintains the link force itself: its `update()` runs
    // after each graphData change and rebinds the link set from the
    // merged links we pass in. We only override the per-link strength
    // accessor (Obsidian-style cluster pull: pairs joined by multiple
    // relations get a proportionally stronger spring) and the rest
    // length, plus the radial center pull above.
    this.configureLinkForce();

    const resize = () => {
      if (!this.containerRef) return;
      fg.width(this.containerRef.clientWidth);
      fg.height(this.containerRef.clientHeight);
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.containerRef);

    this.containerRef.addEventListener("mousemove", this.onMouseMove);

    this.mql = window.matchMedia("(prefers-color-scheme: dark)");
    this.mql.addEventListener?.("change", this.onThemeChange);

    window.addEventListener("keydown", this.onKeyDown);

    // Initial data feed.
    this.feedData();
  }

  componentDidUpdate(prevProps: Props) {
    // Recompute derived graph data if either input identity changed.
    const inputsChanged =
      prevProps.nodes !== this.props.nodes ||
      prevProps.edges !== this.props.edges;
    if (inputsChanged) {
      this.computed = computeGraph(this.props.nodes, this.props.edges);
      this.feedData();
    }

    if (prevProps.hideEdgeLabels !== this.props.hideEdgeLabels) {
      // Edge-label visibility flipped: force a repaint via no-op accessor swap.
      const fg = this.fg;
      if (fg) fg.linkCanvasObject(fg.linkCanvasObject());
    }

    if (prevProps.selectedRef !== this.props.selectedRef) {
      // Selected-node ring change: force a repaint.
      const fg = this.fg;
      if (fg) fg.nodeCanvasObject(fg.nodeCanvasObject());
    }

    if (prevProps.forces !== this.props.forces) {
      this.applyForces();
    }
  }

  componentWillUnmount() {
    this.cancelClickTimer();
    this.cancelEdgeClickTimer();
    if (this.containerRef) {
      this.containerRef.removeEventListener("mousemove", this.onMouseMove);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mql?.removeEventListener?.("change", this.onThemeChange);
    this.mql = null;
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.fg) {
      this.fg.pauseAnimation();
      (this.fg as any)._destructor?.();
    }
    if (this.containerRef) this.containerRef.innerHTML = "";
    this.fg = null;
  }

  private rerender() {
    // No-op accessor swap forces force-graph to repaint immediately.
    const fg = this.fg;
    if (!fg) return;
    fg.nodeCanvasObject(fg.nodeCanvasObject());
  }

  // Feed nodes/links into force-graph, preserving positions and softly
  // re-heating the simulation. The first feed auto-fits the camera after a
  // short delay; later feeds re-fit once the simulation settles.
  private feedData() {
    const fg = this.fg;
    if (!fg) return;
    const { nodes, links, adjacency, radii } = this.computed;
    this.adjacency = adjacency;
    this.radiusMap = radii;

    // Carry over positions from the previous data so existing nodes stay put
    // and new ghosts emerge from the position of an already-placed neighbor
    // (rather than dropping in from random coordinates).
    const prev = fg.graphData().nodes as FGNode[];
    const prevById = new Map<string, FGNode>();
    for (const p of prev) prevById.set(p.id, p);

    for (const n of nodes) {
      const old = prevById.get(n.id);
      if (old) {
        // Existing node — preserve its current physics state.
        n.x = old.x;
        n.y = old.y;
        n.fx = old.fx;
        n.fy = old.fy;
        continue;
      }
      // New node — start at an already-placed connected neighbor.
      const neighbors = adjacency.get(n.id);
      if (!neighbors) continue;
      for (const nbId of neighbors) {
        const placed = prevById.get(nbId);
        if (placed && placed.x !== undefined && placed.y !== undefined) {
          // Tiny jitter avoids stacking new ghosts perfectly on top of each other.
          n.x = placed.x + (Math.random() - 0.5) * 2;
          n.y = placed.y + (Math.random() - 0.5) * 2;
          break;
        }
      }
    }

    fg.graphData({ nodes, links });
    // Re-apply our link-force tuning. force-graph's update() runs after
    // graphData and rebinds the link set from the merged links, but
    // doesn't touch strength/distance accessors. Re-set them now so the
    // per-link multiplicity factor still applies after the rebind.
    this.configureLinkForce();
    this.hoveredId = null;
    this.neighbors = new Set();

    // Auto-fit the camera once the simulation cools (onEngineStop →
    // recenter), never on a fixed timer — fitting mid-layout leaves nodes
    // half off-screen. Bound the run with cooldownTicks so the first
    // from-scratch layout settles in a few hundred ms instead of the
    // engine's multi-second default. recenter() handles the single-node and
    // MAX_AUTO_ZOOM cases.
    this.pendingFit = true;
    fg.cooldownTicks(
      this.fedOnce ? REFIT_COOLDOWN_TICKS : FIRST_FIT_COOLDOWN_TICKS,
    );
    this.fedOnce = true;
  }

  private cancelClickTimer() {
    if (this.clickTimer !== null) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
  }

  private handleNodeClick(node: FGNode) {
    if (this.clickTimer !== null) {
      // Second click within window → treat as double-click.
      this.cancelClickTimer();
      void this.handleDoubleClick(node);
      return;
    }
    this.clickTimer = window.setTimeout(() => {
      this.clickTimer = null;
      this.props.onNodeClick(node.id);
    }, CLICK_DELAY_MS);
  }

  private cancelEdgeClickTimer() {
    if (this.edgeClickTimer !== null) {
      clearTimeout(this.edgeClickTimer);
      this.edgeClickTimer = null;
    }
  }

  private handleLinkClick(link: FGLink) {
    if (this.edgeClickTimer !== null) {
      this.cancelEdgeClickTimer();
      void this.handleLinkDoubleClick(link);
      return;
    }
    this.edgeClickTimer = window.setTimeout(() => {
      this.edgeClickTimer = null;
      // Single click on an edge: no-op for now (no edge selection model).
    }, CLICK_DELAY_MS);
  }

  private async handleLinkDoubleClick(link: FGLink) {
    const prov = link.edge.refs[0];
    if (!prov) return;
    try {
      const ref =
        prov.pos !== undefined ? `${prov.page}@${prov.pos}` : prov.page;
      await editor.navigate(ref);
      await editor.hidePanel("modal");
    } catch (err) {
      console.error("object-graph: edge navigation failed", err);
    }
  }

  private async handleDoubleClick(node: FGNode) {
    try {
      if (node.kind === "url") {
        await editor.openUrl(node.id);
        return;
      }
      // An item/block node whose ref carries no `@pos` holds a bare
      // `$anchor` name (e.g. an item tagged `$pete-ref`). Navigate via the
      // anchor (`$name`, empty page path) so SB resolves it through the
      // index to wherever the anchor currently lives, instead of treating
      // the bare name as a page. Positional refs (`page@pos`), pages and
      // files navigate directly.
      const isAnchorRef =
        (node.kind === "item" || node.kind === "block") &&
        !node.id.includes("@");
      const ref = isAnchorRef ? `$${node.id}` : node.id;
      await editor.navigate(ref);
      await editor.hidePanel("modal");
    } catch (err) {
      console.error("object-graph: navigation failed", err);
    }
  }

  private isHighlighted(id: string): boolean {
    const hov = this.hoveredId;
    if (!hov) return true;
    return id === hov || this.neighbors.has(id);
  }

  private linkTouchesHover(link: FGLink): boolean {
    const hov = this.hoveredId;
    if (!hov) return false;
    return getId(link.source) === hov || getId(link.target) === hov;
  }

  private drawNode(node: FGNode, ctx: CanvasRenderingContext2D, scale: number) {
    const t = this.theme;
    const radius = this.radiusMap.get(node.id) ?? nodeRadius(node.degree);
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const highlighted = this.isHighlighted(node.id);
    const isSelected = node.id === this.props.selectedRef;

    ctx.save();
    let alpha = node.status === "ghost" ? 0.45 : 1;
    if (!highlighted) alpha *= 0.35;
    ctx.globalAlpha = alpha;

    if (node.dangling) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = t.bg || "#fff";
      ctx.fill();
      ctx.setLineDash([3 / scale, 2 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = t.nodeDim;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
    }

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 2 / scale, 0, Math.PI * 2);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = t.accent;
      ctx.stroke();
    }

    // Label rendered BELOW the node, scaled to constant screen pixels.
    // Hide when zoomed way out OR when this node is dimmed by hover.
    const showLabel =
      scale >= NODE_LABEL_MIN_SCALE && (highlighted || this.hoveredId === null);
    if (showLabel) {
      const fontPx = isSelected ? 13 : 11;
      const fontSize = fontPx / scale;
      ctx.font = `${isSelected ? "600 " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const name = displayName(node.title);
      const label = node.prefix ? `${node.prefix}${name}` : name;
      const gap = 4 / scale;
      // Halo behind the label for legibility over edges.
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = t.labelHalo;
      ctx.strokeText(label, x, y + radius + gap);
      ctx.fillStyle = node.dangling ? t.nodeDim : t.label;
      ctx.fillText(label, x, y + radius + gap);
    }
    ctx.restore();
  }

  private drawLink(link: FGLink, ctx: CanvasRenderingContext2D, scale: number) {
    const t = this.theme;
    const source = link.source as FGNode;
    const target = link.target as FGNode;
    if (
      typeof source !== "object" ||
      typeof target !== "object" ||
      source.x === undefined ||
      target.x === undefined
    )
      return;

    const sx = source.x!;
    const sy = source.y!;
    const tx = target.x!;
    const ty = target.y!;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const sR = this.radiusMap.get(source.id) ?? 12;
    const tR = this.radiusMap.get(target.id) ?? 12;
    const ax = sx + sR * ux;
    const ay = sy + sR * uy;
    const bx = tx - tR * ux;
    const by = ty - tR * uy;

    const kind: string = link.edge.kind;
    const dimmed = STRUCTURAL_KINDS.has(kind);
    const hov = this.hoveredId;
    const touches = this.linkTouchesHover(link);

    let strokeStyle: string;
    let alpha = 1;
    if (hov) {
      if (touches) {
        strokeStyle = t.linkHot;
      } else {
        strokeStyle = t.linkDim;
        alpha = 0.5;
      }
    } else {
      strokeStyle = dimmed ? t.linkDim : t.link;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = (touches ? 1.8 : 1.2) / scale;
    if (dimmed) ctx.setLineDash([3 / scale, 3 / scale]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowheads — skip on undirected co-mention collapses.
    if (!link.edge.undirected) {
      const headLen = 7 / scale;
      const drawHead = (hx: number, hy: number, angle: number) => {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(
          hx - headLen * Math.cos(angle - Math.PI / 6),
          hy - headLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          hx - headLen * Math.cos(angle + Math.PI / 6),
          hy - headLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.fillStyle = strokeStyle;
        ctx.fill();
      };
      // Target-end arrow.
      drawHead(bx, by, Math.atan2(uy, ux));
      // Source-end arrow when both directions exist between this pair.
      if (link.edge.bidirectional) drawHead(ax, ay, Math.atan2(-uy, -ux));
    }

    // Rotated edge label riding above the midpoint.
    // Suppressed entirely when the global "hide labels" toggle is on,
    // unless the edge is incident to the hovered node.
    const label = link.edge.label;
    const labelsAllowed = !this.props.hideEdgeLabels || touches;
    const showLabel =
      label && labelsAllowed && (touches || scale >= EDGE_LABEL_MIN_SCALE);
    if (showLabel) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      let angle = Math.atan2(by - ay, bx - ax);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      ctx.translate(mx, my);
      ctx.rotate(angle);
      const fontSize = 10 / scale;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = t.labelHalo;
      ctx.strokeText(label, 0, -2 / scale);
      ctx.fillStyle = dimmed ? t.labelDim : t.label;
      ctx.fillText(label, 0, -2 / scale);
    }
    ctx.restore();
  }

  private zoomIn() {
    const fg = this.fg;
    if (!fg) return;
    fg.zoom(fg.zoom() * 1.4, 250);
  }

  private zoomOut() {
    const fg = this.fg;
    if (!fg) return;
    fg.zoom(fg.zoom() / 1.4, 250);
  }

  // dx/dy in {-1, 0, 1} — step scales inversely with zoom so the visual
  // pan distance stays constant.
  private pan(dx: number, dy: number) {
    const fg = this.fg;
    if (!fg) return;
    const step = 80 / fg.zoom();
    const c = fg.centerAt();
    if (!c) return;
    fg.centerAt(c.x + dx * step, c.y + dy * step, 250);
  }

  private recenter() {
    const fg = this.fg;
    if (!fg) return;
    if (this.computed.nodes.length <= 1) {
      fg.centerAt(0, 0, 400);
      fg.zoom(2, 400);
      return;
    }
    fg.zoomToFit(400, 40);
    if (fg.zoom() > MAX_AUTO_ZOOM) fg.zoom(MAX_AUTO_ZOOM, 400);
  }

  render() {
    const { edgeHover, ghostHover } = this.state;
    const isEmpty = this.computed.nodes.length === 0;
    return (
      <div class="gv-canvas-wrap">
        <div
          ref={(el) => {
            this.containerRef = el;
          }}
          class="graph-canvas"
        />
        {isEmpty && <div class="gv-empty">Graph is empty</div>}
        {edgeHover && <EdgeTooltip {...edgeHover} />}
        {ghostHover && !edgeHover && <GhostTooltip {...ghostHover} />}
        <div class="graph-controls">
          <div class="graph-pan">
            <button
              type="button"
              class="graph-pan-up"
              title="Pan up"
              onClick={() => this.pan(0, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              class="graph-pan-left"
              title="Pan left"
              onClick={() => this.pan(-1, 0)}
            >
              ←
            </button>
            <button
              type="button"
              class="graph-pan-center"
              title="Fit to view"
              onClick={this.recenter}
            >
              ⊙
            </button>
            <button
              type="button"
              class="graph-pan-right"
              title="Pan right"
              onClick={() => this.pan(1, 0)}
            >
              →
            </button>
            <button
              type="button"
              class="graph-pan-down"
              title="Pan down"
              onClick={() => this.pan(0, 1)}
            >
              ↓
            </button>
          </div>
          <div class="graph-zoom">
            <button type="button" title="Zoom in" onClick={this.zoomIn}>
              +
            </button>
            <button type="button" title="Zoom out" onClick={this.zoomOut}>
              −
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function GhostTooltip({
  title,
  x,
  y,
}: {
  title: string;
  x: number;
  y: number;
}) {
  return (
    <div
      class="gv-ghost-tooltip"
      style={{ left: `${x + 14}px`, top: `${y + 14}px` }}
    >
      Click to add <strong>{title}</strong> to the graph
    </div>
  );
}

function EdgeTooltip({
  edge,
  x,
  y,
}: {
  edge: MergedEdge;
  x: number;
  y: number;
}) {
  // Collect distinct, trimmed snippets across all merged provenance refs.
  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const r of edge.refs) {
    const s = r.snippet?.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    snippets.push(s);
  }
  return (
    <div
      class="gv-edge-tooltip"
      style={{ left: `${x + 14}px`, top: `${y + 14}px` }}
    >
      <div class="gv-edge-tooltip-label">{edge.label}</div>
      {snippets.length === 0 ? (
        <div class="gv-edge-tooltip-snippet gv-edge-tooltip-empty">
          (no snippet)
        </div>
      ) : (
        snippets.map((s, i) => (
          <div class="gv-edge-tooltip-snippet" key={i}>
            {s}
          </div>
        ))
      )}
    </div>
  );
}
