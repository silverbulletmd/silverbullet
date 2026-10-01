import { RowText } from "./row_text.tsx";
import { Component } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { highlightMatches } from "./highlight.tsx";
import { HoverTracker, resolveHover, useHovered } from "./hover.ts";
import { Icon } from "./icon.tsx";
import { RowActions } from "./row_actions.tsx";
import { revealInClosest } from "./scroll.ts";
import { allFolderPaths, findNode, type TreeNode } from "./tree_model.ts";
import type { ActionMeta, Decoration, RowStates } from "./tree_types.ts";

/** How long a collapsed folder has to be hovered before it springs open. */
const SPRING_LOAD_MS = 700;

const DRAG_MIME = "application/x-sb-nav-path";

/** Sibling lists longer than this render in steps as they scroll into view. */
const RENDER_CHUNK = 200;
/** An unrendered row's height until the rendered ones have been measured. */
const ESTIMATED_ROW_PX = 36;
/** A window that outgrows this sheds the rows furthest from the viewport. */
const MAX_WINDOW = 5 * RENDER_CHUNK;

const NOTHING_EXPANDED = new Set<string>();

export function externalFilesDrag(
  types: readonly string[],
  enabled: boolean,
): boolean {
  return (
    enabled &&
    types.includes("Files") &&
    !types.includes(DRAG_MIME) &&
    !types.includes("application/x-sb-space-file")
  );
}

type FileDragData = { mime: string; payload: string; downloadURL: string };

export function targetFolderForPath(
  path: string | undefined,
  folders: Set<string>,
  separator: string,
): string {
  if (path === undefined) return "";
  if (folders.has(path)) return path;
  const index = path.lastIndexOf(separator);
  return index === -1 ? "" : path.slice(0, index);
}

export function activateTreeRow<T extends { path: string; isFolder: boolean }>(
  node: T,
  onSelect: ((node: T) => void) | undefined,
  onToggle: (path: string) => void,
): void {
  if (onSelect) onSelect(node);
  else if (node.isFolder) onToggle(node.path);
}

function Chip({ decoration }: { decoration: Decoration }) {
  return (
    <span
      class={"sb-nav-chip " + (decoration.cssClass ?? "")}
      title={decoration.title}
    >
      {decoration.text ?? decoration.icon}
    </span>
  );
}

export type TreeViewProps = {
  tree: TreeNode;
  expanded: Set<string>;
  selectedPath?: string;
  currentPath?: string;
  phrase?: string;
  showEmpty: boolean;
  separator: string;
  /** Whether rows are drag sources / drop targets at all. */
  canDrag: boolean;
  fileDragData?: (node: TreeNode) => FileDragData | null;
  nativeFileDrag?: (payload: string) => void;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  documentActions?: boolean;
  actionsDisabled?: boolean;
  rowState?: RowStates;
  /** Whether the tree defines row icons at all, i.e. reserves the slot. */
  hasIcon: boolean;
  readOnly: boolean;
  onToggle: (path: string) => void;
  onSelect?: (node: TreeNode) => void;
  onMove: (draggedPath: string, targetFolder: string) => void;
  onExternalFiles?: (transfer: DataTransfer, targetFolder: string) => void;
  onAction: (node: TreeNode, actionIndex: number) => void;
  scrollContainerSelector?: string;
  focusableRows?: boolean;
  onRowKeyDown?: (node: TreeNode, event: KeyboardEvent) => void;
};

export function TreeView({
  tree,
  expanded,
  selectedPath,
  currentPath,
  phrase,
  showEmpty,
  separator,
  canDrag,
  fileDragData,
  nativeFileDrag,
  actions,
  actionIcons,
  documentActions,
  actionsDisabled,
  rowState,
  hasIcon,
  readOnly,
  onToggle,
  onSelect,
  onMove,
  onExternalFiles,
  onAction,
  scrollContainerSelector,
  focusableRows,
  onRowKeyDown,
}: TreeViewProps) {
  const selectedRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  // Track hover outside parent state to avoid re-rendering the whole tree.
  const hover = useMemo(() => new HoverTracker(), []);
  // dataTransfer.getData is unavailable until drop; dragover needs this ref.
  const dragging = useRef<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  // Mirror of the above, so the drag handlers never read a stale closure.
  const dropRef = useRef<string | undefined>(undefined);
  const springTimer = useRef<number | undefined>(undefined);

  const folderPaths = useMemo(() => allFolderPaths(tree), [tree]);
  // Hosts pass fresh closures on every render; rows reach them through this
  // ref so a memoized row doesn't re-render just because a callback did.
  const latest = useRef({
    onToggle,
    onSelect,
    onAction,
    onRowKeyDown,
    fileDragData,
  });
  latest.current = { onToggle, onSelect, onAction, onRowKeyDown, fileDragData };
  const handlers = useMemo<RowHandlers>(
    () => ({
      toggle: (path) => latest.current.onToggle(path),
      select: (node) => latest.current.onSelect?.(node),
      action: (node, index) => latest.current.onAction(node, index),
      keyDown: (node, event) => latest.current.onRowKeyDown?.(node, event),
    }),
    [],
  );
  const hasFileDrag = !!fileDragData;
  // Only for rows that are actually drawn (or dragged), once per node.
  const fileDragFor = useMemo(() => {
    const cache = new WeakMap<TreeNode, FileDragData | null>();
    return (node: TreeNode): FileDragData | null => {
      const compute = latest.current.fileDragData;
      if (!compute) return null;
      let data = cache.get(node);
      if (data === undefined) {
        data = compute(node);
        cache.set(node, data);
      }
      return data;
    };
  }, [tree, hasFileDrag]);

  /** The path a DOM node's row carries, if it is in one. */
  const pathAt = (node: Element | null) =>
    (node?.closest?.("[data-path]") as HTMLElement | null)?.dataset?.path;

  // Depending on tree would reset manual scrolling on every refresh.
  useEffect(() => {
    if (scrollContainerSelector) {
      revealInClosest(selectedRef.current, scrollContainerSelector);
    }
  }, [selectedPath, scrollContainerSelector]);

  // A pruned/expanded/refreshed tree, or a scroll the pointer didn't ask for:
  // a different row now sits where the pointer is parked.
  useEffect(() => {
    resolveHover(hover, pathAt);
  }, [tree, expanded, selectedPath, hover]);

  useEffect(() => () => clearTimeout(springTimer.current), []);

  function parentOf(path: string): string {
    const index = path.lastIndexOf(separator);
    return index === -1 ? "" : path.slice(0, index);
  }

  /**
   * The folder a drop at this point lands in: the row itself when it's a
   * folder, its parent folder when it's a page (Finder-style -- without it
   * the rows would blanket the tree and leave the root unreachable), and the
   * root for the tree's own area.
   */
  function targetFor(e: DragEvent): string {
    const row = (e.target as HTMLElement | null)?.closest?.("[data-path]");
    const path = (row as HTMLElement | null)?.dataset?.path;
    return targetFolderForPath(path, folderPaths, separator);
  }

  function isValidTarget(from: string, to: string): boolean {
    if (to === from) return false;
    if (to.startsWith(from + separator)) return false; // its own subtree
    return to !== parentOf(from); // already there
  }

  function armSpringLoad(path: string) {
    clearTimeout(springTimer.current);
    springTimer.current = undefined;
    if (path === "" || expanded.has(path) || !folderPaths.has(path)) return;
    springTimer.current = setTimeout(() => {
      springTimer.current = undefined;
      if (dropRef.current === path) onToggle(path);
    }, SPRING_LOAD_MS) as unknown as number;
  }

  function setTarget(path: string | undefined) {
    if (dropRef.current === path) return;
    dropRef.current = path;
    setDropTarget(path);
    if (path !== undefined) armSpringLoad(path);
  }

  function endDrag() {
    clearTimeout(springTimer.current);
    springTimer.current = undefined;
    dragging.current = undefined;
    setTarget(undefined);
  }

  function onDragStart(e: DragEvent) {
    const row = (e.target as HTMLElement | null)?.closest?.("[data-path]");
    const path = (row as HTMLElement | null)?.dataset?.path;
    if (!path) return;
    const node = findNode(tree, path);
    const file = node ? fileDragFor(node) : null;
    if (file && nativeFileDrag) {
      e.preventDefault();
      nativeFileDrag(file.payload);
      return;
    }
    if (canDrag) {
      dragging.current = path;
      e.dataTransfer?.setData(DRAG_MIME, path);
    }
    if (file) {
      e.dataTransfer?.setData(file.mime, file.payload);
      e.dataTransfer?.setData("DownloadURL", file.downloadURL);
    }
    if (e.dataTransfer)
      e.dataTransfer.effectAllowed = file
        ? canDrag
          ? "copyMove"
          : "copy"
        : "move";
  }

  function onDragOver(e: DragEvent) {
    const from = dragging.current;
    if (
      from === undefined &&
      externalFilesDrag([...(e.dataTransfer?.types ?? [])], !!onExternalFiles)
    ) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setTarget(targetFor(e));
      return;
    }
    if (from === undefined) return;
    const to = targetFor(e);
    if (!isValidTarget(from, to)) {
      setTarget(undefined);
      return;
    }
    // The whole contract of HTML5 DnD: preventDefault means "droppable here".
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setTarget(to);
  }

  function onDragLeave(e: DragEvent) {
    // dragleave also fires for every row-to-row move inside the tree; only a
    // pointer that actually left the container clears the highlight.
    const to = e.relatedTarget as Node | null;
    if (to && treeRef.current?.contains(to)) return;
    clearTimeout(springTimer.current);
    springTimer.current = undefined;
    setTarget(undefined);
  }

  function onDrop(e: DragEvent) {
    const types = [...(e.dataTransfer?.types ?? [])];
    const external = externalFilesDrag(types, !!onExternalFiles);
    if (!dragging.current && !external && !types.includes(DRAG_MIME)) return;
    e.preventDefault();
    const from = dragging.current ?? e.dataTransfer?.getData(DRAG_MIME);
    const to = targetFor(e);
    // Drags emit no pointer events; save the drop position for hover resolution.
    hover.track(e, pathAt);
    endDrag();
    if (external && e.dataTransfer) {
      onExternalFiles?.(e.dataTransfer, to);
      return;
    }
    if (from && isValidTarget(from, to)) onMove(from, to);
  }

  if (tree.children.length === 0 && !onExternalFiles) {
    return showEmpty ? <div class="sb-nav-empty">No results</div> : null;
  }

  return (
    <ul
      ref={treeRef}
      role="tree"
      class={"sb-tree" + (dropTarget === "" ? " sb-nav-droptarget" : "")}
      // Delegated: one set of listeners for the whole tree, and the row a
      // drop resolves to isn't always the row under the pointer anyway.
      onDragStart={canDrag || fileDragData ? onDragStart : undefined}
      onDragOver={canDrag || onExternalFiles ? onDragOver : undefined}
      onDragLeave={canDrag || onExternalFiles ? onDragLeave : undefined}
      onDrop={canDrag || onExternalFiles ? onDrop : undefined}
      onDragEnd={
        canDrag || fileDragData || onExternalFiles ? endDrag : undefined
      }
      onPointerOver={(e) => hover.track(e, pathAt)}
      onPointerLeave={() => hover.set(undefined)}
    >
      {dropTarget !== undefined && onExternalFiles && !dragging.current && (
        <li role="presentation" class="sb-nav-upload-target">
          <span>Upload to {dropTarget || "Space root"}</span>
        </li>
      )}
      <ChildList
        nodes={tree.children}
        depth={0}
        parent={tree}
        props={{
          expanded,
          selectedPath,
          currentPath,
          hover,
          dropTarget,
          draggable: canDrag,
          fileDragFor,
          phrase,
          actions,
          actionIcons,
          documentActions,
          actionsDisabled,
          rowState,
          hasIcon,
          readOnly,
          selectable: !!onSelect,
          keyed: !!onRowKeyDown,
          handlers,
          selectedRef,
          focusableRows,
          separator,
          scrollContainerSelector,
        }}
      />
    </ul>
  );
}

type RowHandlers = {
  toggle: (path: string) => void;
  select: (node: TreeNode) => void;
  action: (node: TreeNode, actionIndex: number) => void;
  keyDown: (node: TreeNode, event: KeyboardEvent) => void;
};

/** What every row of one tree shares. `expanded`, `selectedPath`,
 * `currentPath` and `dropTarget` are narrowed per row (see `rowProps`), which
 * is what lets a memoized row skip renders that can't change it. */
type SharedRowProps = {
  expanded: Set<string>;
  selectedPath?: string;
  currentPath?: string;
  hover: HoverTracker;
  dropTarget?: string;
  draggable: boolean;
  fileDragFor: (node: TreeNode) => FileDragData | null;
  phrase?: string;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  documentActions?: boolean;
  actionsDisabled?: boolean;
  rowState?: RowStates;
  hasIcon: boolean;
  readOnly: boolean;
  selectable: boolean;
  keyed: boolean;
  handlers: RowHandlers;
  selectedRef: { current: HTMLDivElement | null };
  focusableRows?: boolean;
  separator: string;
  scrollContainerSelector?: string;
};

function inSubtree(
  path: string | undefined,
  node: TreeNode,
  separator: string,
): boolean {
  if (path === undefined) return false;
  // The root has no path of its own; everything is under it.
  if (node.path === "") return true;
  return (
    path === node.path ||
    (node.isFolder && path.startsWith(node.path + separator))
  );
}

function rowProps(node: TreeNode, shared: SharedRowProps): SharedRowProps {
  const { separator } = shared;
  const within = (path: string | undefined) =>
    inSubtree(path, node, separator) ? path : undefined;
  return {
    ...shared,
    expanded:
      node.isFolder && shared.expanded.has(node.path)
        ? shared.expanded
        : NOTHING_EXPANDED,
    selectedPath: within(shared.selectedPath),
    currentPath: within(shared.currentPath),
    dropTarget: within(shared.dropTarget),
  };
}

/** The rendered slice of a long list, moved to include each `required`
 * index: extended when it lies close by, re-centred when it lies far away. */
export function windowIncluding(
  window: [number, number],
  required: number[],
  length: number,
): [number, number] {
  let [start, end] = window;
  for (const index of required) {
    if (index >= start && index < end) continue;
    if (index < start - RENDER_CHUNK || index >= end + RENDER_CHUNK) {
      start = Math.max(0, index - RENDER_CHUNK / 2);
      end = start + RENDER_CHUNK;
    } else {
      start = Math.min(start, index);
      end = Math.max(end, index + 1);
    }
  }
  end = Math.min(end, length);
  start = Math.max(0, Math.min(start, end - RENDER_CHUNK));
  return [start, end];
}

/** The rendered slice after rows `visible` came into view: extended when they
 * border it, moved when the scrollbar jumped far, and trimmed on the far side
 * once it outgrows `MAX_WINDOW`. */
export function windowShowing(
  window: [number, number],
  visible: [number, number],
  length: number,
): [number, number] {
  const [from, to] = visible;
  let [start, end] = window;
  if (to >= start - RENDER_CHUNK && from <= end + RENDER_CHUNK) {
    start = Math.min(start, from);
    end = Math.max(end, to);
  } else {
    start = from;
    end = to;
  }
  if (end - start > MAX_WINDOW) {
    start = Math.max(start, from - RENDER_CHUNK);
    end = Math.min(end, to + RENDER_CHUNK);
  }
  start = Math.max(0, Math.min(start, from - RENDER_CHUNK / 2));
  end = Math.min(length, Math.max(end, to + RENDER_CHUNK / 2));
  return [start, end];
}

/**
 * A sibling list. Short ones render whole; a long one (a flat folder of
 * thousands of pages) renders a window of rows between two spacers sized
 * like the rows they stand in for, and grows the window as a spacer scrolls
 * into view. The window always includes the selected and current rows.
 */
function ChildList({
  nodes,
  depth,
  parent,
  props,
}: {
  nodes: TreeNode[];
  depth: number;
  parent: TreeNode;
  props: SharedRowProps;
}) {
  const progressive =
    nodes.length > RENDER_CHUNK && typeof IntersectionObserver !== "undefined";
  const windowRef = useRef<[number, number]>([0, RENDER_CHUNK]);
  // Only a selection or current page that *moved* pulls the window to it;
  // otherwise scrolling away from it would snap straight back.
  const requiredKey = useRef<string | undefined>(undefined);
  const [, rerender] = useState(0);
  // Measured from the rendered rows, since font size, touch layouts and
  // wrapping descriptions all change it; spacers and scroll math both use it.
  const rowHeight = useRef(ESTIMATED_ROW_PX);
  const before = useRef<HTMLLIElement>(null);
  const after = useRef<HTMLLIElement>(null);
  const { selectedPath, currentPath, separator, scrollContainerSelector } =
    props;
  let start = 0;
  let end = nodes.length;
  if (progressive) {
    const required: number[] = [];
    for (const path of [selectedPath, currentPath]) {
      if (path === undefined || !inSubtree(path, parent, separator)) continue;
      const index = nodes.findIndex((n) => inSubtree(path, n, separator));
      if (index !== -1) required.push(index);
    }
    const key = required.join(",");
    if (key !== requiredKey.current) {
      requiredKey.current = key;
      windowRef.current = windowIncluding(
        windowRef.current,
        required,
        nodes.length,
      );
    }
    [start, end] = windowRef.current;
    end = Math.min(end, nodes.length);
    start = Math.min(start, end);
  }

  useLayoutEffect(() => {
    if (!progressive) return;
    const rows: Element[] = [];
    if (after.current) {
      let row = after.current.previousElementSibling;
      while (row && row !== before.current) {
        rows.push(row);
        row = row.previousElementSibling;
      }
    } else {
      let row = before.current?.nextElementSibling ?? null;
      while (row) {
        rows.push(row);
        row = row.nextElementSibling;
      }
    }
    // A row's own line, not its `<li>`: an expanded folder's subtree isn't
    // what the spacers stand in for.
    let total = 0;
    let measured = 0;
    for (const row of rows) {
      if (row.getAttribute("role") !== "treeitem") continue;
      const height = (row.firstElementChild as HTMLElement | null)
        ?.offsetHeight;
      if (height) {
        total += height;
        measured++;
      }
    }
    if (measured === 0) return;
    const average = total / measured;
    if (Math.abs(average - rowHeight.current) < 0.5) return;
    rowHeight.current = average;
    rerender((n) => n + 1);
  }, [progressive, start, end]);

  useEffect(() => {
    if (!progressive) return;
    const edges = [before.current, after.current].filter(
      (e): e is HTMLLIElement => e !== null,
    );
    if (edges.length === 0) return;
    const root = scrollContainerSelector
      ? edges[0].closest(scrollContainerSelector)
      : null;
    const observer = new IntersectionObserver(
      (entries) => {
        let next = windowRef.current;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const rect = entry.boundingClientRect;
          const top = Math.max(rect.top, entry.intersectionRect.top);
          const bottom = Math.min(rect.bottom, entry.intersectionRect.bottom);
          const offset = entry.target === before.current ? 0 : next[1];
          // Observer geometry is in rendered pixels, which CSS `zoom` makes
          // differ from the layout pixels the rows were measured in.
          const layoutHeight = (entry.target as HTMLElement).offsetHeight;
          const scale = layoutHeight > 0 ? rect.height / layoutHeight : 1;
          const rendered = rowHeight.current * scale;
          const from = offset + Math.floor((top - rect.top) / rendered);
          const to = offset + Math.ceil((bottom - rect.top) / rendered);
          next = windowShowing(next, [from, to], nodes.length);
        }
        const [currentStart, currentEnd] = windowRef.current;
        if (next[0] === currentStart && next[1] === currentEnd) return;
        windowRef.current = next;
        rerender((n) => n + 1);
      },
      { root, rootMargin: "600px 0px" },
    );
    for (const edge of edges) observer.observe(edge);
    return () => observer.disconnect();
  }, [progressive, start, end, nodes, scrollContainerSelector]);

  const rows = (
    start === 0 && end === nodes.length ? nodes : nodes.slice(start, end)
  ).map((n) => (
    <TreeItem key={n.path} {...rowProps(n, props)} node={n} depth={depth} />
  ));
  if (start === 0 && end === nodes.length) return <>{rows}</>;
  const spacer = (ref: typeof before, count: number) =>
    count > 0 && (
      <li
        ref={ref}
        role="presentation"
        class="sb-tree-more"
        style={{ height: `${count * rowHeight.current}px` }}
      />
    );
  return (
    <>
      {spacer(before, start)}
      {rows}
      {spacer(after, nodes.length - end)}
    </>
  );
}

type TreeItemProps = SharedRowProps & { node: TreeNode; depth: number };

/** A row re-renders only when one of its (narrowed) props changed. Not
 * `preact/compat`'s `memo`: that would pull compat into every plug bundle. */
class TreeItem extends Component<TreeItemProps> {
  override shouldComponentUpdate(next: TreeItemProps): boolean {
    for (const key in next) {
      if ((next as any)[key] !== (this.props as any)[key]) return true;
    }
    return false;
  }

  override render() {
    return <TreeItemRow {...this.props} />;
  }
}

function TreeItemRow(props: TreeItemProps) {
  const {
    node,
    depth,
    expanded,
    selectedPath,
    currentPath,
    hover,
    dropTarget,
    draggable,
    fileDragFor,
    phrase,
    actions,
    actionIcons,
    documentActions,
    actionsDisabled,
    rowState,
    hasIcon,
    readOnly,
    selectable,
    keyed,
    handlers,
    selectedRef,
    focusableRows,
  } = props;
  const isExpanded = node.isFolder && expanded.has(node.path);
  const selected = selectedPath === node.path;
  // Unconditional: a hook call behind `selected ||` would change the hook
  // order the moment the selection moved onto this row.
  const hovered = useHovered(hover, node.path);
  const decorations = node.row?.decorations ?? [];
  const state = rowState?.byPath?.get(node.path);

  return (
    <li
      role="treeitem"
      aria-expanded={node.isFolder ? isExpanded : undefined}
      class="sb-treeitem"
    >
      <div
        ref={selected ? selectedRef : undefined}
        class={
          "sb-nav-row" +
          (node.isFolder ? " sb-nav-folder" : "") +
          (node.isFolder && node.row ? " sb-nav-dual" : "") +
          (selected ? " sb-nav-selected" : "") +
          (!selectable && !node.isFolder ? " sb-nav-passive" : "") +
          (dropTarget === node.path ? " sb-nav-droptarget" : "") +
          (node.row?.cssClass ? ` ${node.row.cssClass}` : "")
        }
        style={{
          paddingLeft: `calc(var(--sb-tree-row-inset, 0px) + ${depth} * var(--sb-tree-indent, 1.2rem))`,
        }}
        data-path={node.path}
        aria-current={currentPath === node.path ? "page" : undefined}
        draggable={draggable || fileDragFor(node) !== null}
        tabIndex={focusableRows ? 0 : undefined}
        onKeyDown={
          keyed ? (e) => handlers.keyDown(node, e as KeyboardEvent) : undefined
        }
        onClick={
          selectable || node.isFolder
            ? () =>
                activateTreeRow(
                  node,
                  selectable ? handlers.select : undefined,
                  handlers.toggle,
                )
            : undefined
        }
      >
        {node.isFolder ? (
          <span
            class="sb-nav-chevron"
            onClick={(e) => {
              e.stopPropagation();
              handlers.toggle(node.path);
            }}
          >
            {isExpanded ? "▾" : "▸"}
          </span>
        ) : (
          <span class="sb-nav-chevron-spacer" />
        )}
        {hasIcon &&
          (state?.icon ? (
            <Icon node={state.icon} class="sb-nav-icon" />
          ) : (
            // Empty, not absent: rows stay aligned whether or not this node
            // resolved an icon.
            <span class="sb-nav-icon" />
          ))}
        <RowText
          primary={
            <span class="sb-nav-primary">
              {highlightMatches(node.row?.label ?? node.segment, phrase)}
            </span>
          }
          description={node.row?.description}
        />
        {decorations.map((d, i) => (
          <Chip key={i} decoration={d} />
        ))}
        {actions && (documentActions || selected || hovered) && (
          <RowActions
            actions={actions}
            icons={actionIcons}
            mask={state?.actions}
            readOnly={readOnly}
            documentMode={documentActions}
            disabled={actionsDisabled}
            onRun={(actionIndex) => handlers.action(node, actionIndex)}
          />
        )}
      </div>
      {isExpanded && (
        <ul role="group">
          <ChildList
            nodes={node.children}
            depth={depth + 1}
            parent={node}
            props={props}
          />
        </ul>
      )}
    </li>
  );
}
