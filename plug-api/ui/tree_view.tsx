import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { highlightMatches } from "./highlight.tsx";
import { HoverTracker, resolveHover, useHovered } from "./hover.ts";
import { Icon } from "./icon.tsx";
import { RowActions } from "./row_actions.tsx";
import { revealInClosest } from "./scroll.ts";
import { allFolderPaths, type TreeNode } from "./tree_model.ts";
import type { ActionMeta, Decoration, RowStates } from "./tree_types.ts";

/** How long a collapsed folder has to be hovered before it springs open. */
const SPRING_LOAD_MS = 700;

const DRAG_MIME = "application/x-sb-nav-path";

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
  phrase?: string;
  showEmpty: boolean;
  separator: string;
  /** Whether rows are drag sources / drop targets at all. */
  canDrag: boolean;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  rowState?: RowStates;
  /** Whether the tree defines row icons at all, i.e. reserves the slot. */
  hasIcon: boolean;
  readOnly: boolean;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
  onMove: (draggedPath: string, targetFolder: string) => void;
  onAction: (node: TreeNode, actionIndex: number) => void;
  /**
   * A selector (from the selected row, via `closest()`) of the container to
   * scroll into view within on selection change. No reveal happens if
   * omitted -- there's no generic "the" scroll container to guess at.
   */
  scrollContainerSelector?: string;
};

export function TreeView({
  tree,
  expanded,
  selectedPath,
  phrase,
  showEmpty,
  separator,
  canDrag,
  actions,
  actionIcons,
  rowState,
  hasIcon,
  readOnly,
  onToggle,
  onSelect,
  onMove,
  onAction,
  scrollContainerSelector,
}: TreeViewProps) {
  const selectedRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  // Which row's actions are mounted besides the selected one's. Outside the
  // render tree (see hover.ts): held here as state, every pointer transition
  // between rows would re-render the whole expanded tree.
  const hover = useMemo(() => new HoverTracker(), []);
  // The path being dragged. A ref, not state: `dataTransfer.getData` is
  // deliberately unreadable until the drop, so every dragover has to consult
  // this instead -- and nothing renders from it.
  const dragging = useRef<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  // Mirror of the above, so the drag handlers never read a stale closure.
  const dropRef = useRef<string | undefined>(undefined);
  const springTimer = useRef<number | undefined>(undefined);

  const folderPaths = useMemo(() => allFolderPaths(tree), [tree]);

  /** The path a DOM node's row carries, if it is in one. */
  const pathAt = (node: Element | null) =>
    (node?.closest?.("[data-path]") as HTMLElement | null)?.dataset?.path;

  // Deliberately keyed on the selection alone: `tree` is a fresh object after
  // every refresh, and re-revealing there would yank the user's manual scroll
  // position back to the selected row roughly once a second.
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
    const idx = path.lastIndexOf(separator);
    return idx === -1 ? "" : path.slice(0, idx);
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
    if (path === undefined) return "";
    return folderPaths.has(path) ? path : parentOf(path);
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
    dragging.current = path;
    e.dataTransfer?.setData(DRAG_MIME, path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: DragEvent) {
    const from = dragging.current;
    // Anything dragged in from outside the tree (a file, a text selection)
    // is not ours to accept.
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
    e.preventDefault();
    const from = dragging.current ?? e.dataTransfer?.getData(DRAG_MIME);
    const to = targetFor(e);
    // A drag emits no pointer events, so the tracker still holds wherever the
    // pointer was when the drag started -- rows away from where it now is.
    // The drop is the only event that says where it ended up, and the effect
    // above re-resolves from these coordinates once the move lands.
    hover.track(e, pathAt);
    endDrag();
    if (from && isValidTarget(from, to)) onMove(from, to);
  }

  if (tree.children.length === 0) {
    return showEmpty ? <div class="sb-nav-empty">No results</div> : null;
  }

  return (
    <ul
      ref={treeRef}
      role="tree"
      class={"sb-tree" + (dropTarget === "" ? " sb-nav-droptarget" : "")}
      // Delegated: one set of listeners for the whole tree, and the row a
      // drop resolves to isn't always the row under the pointer anyway.
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDragLeave={canDrag ? onDragLeave : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? endDrag : undefined}
      onPointerOver={(e) => hover.track(e, pathAt)}
      onPointerLeave={() => hover.set(undefined)}
    >
      {tree.children.map((n) => (
        <TreeItem
          key={n.path}
          node={n}
          depth={0}
          expanded={expanded}
          selectedPath={selectedPath}
          hover={hover}
          dropTarget={dropTarget}
          draggable={canDrag}
          phrase={phrase}
          actions={actions}
          actionIcons={actionIcons}
          rowState={rowState}
          hasIcon={hasIcon}
          readOnly={readOnly}
          onToggle={onToggle}
          onSelect={onSelect}
          onAction={onAction}
          selectedRef={selectedRef}
        />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  depth,
  expanded,
  selectedPath,
  hover,
  dropTarget,
  draggable,
  phrase,
  actions,
  actionIcons,
  rowState,
  hasIcon,
  readOnly,
  onToggle,
  onSelect,
  onAction,
  selectedRef,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedPath?: string;
  hover: HoverTracker;
  dropTarget?: string;
  draggable: boolean;
  phrase?: string;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  rowState?: RowStates;
  hasIcon: boolean;
  readOnly: boolean;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
  onAction: (node: TreeNode, actionIndex: number) => void;
  selectedRef: { current: HTMLDivElement | null };
}) {
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
          // Folders (including page/folder duals) head a section of the tree,
          // and are styled as its header -- see the stylesheet.
          (node.isFolder ? " sb-nav-folder" : "") +
          // A dual: a folder whose name is also something you can open. It
          // draws with the same folder icon a pure folder gets, so the row
          // needs a mark of its own -- see the stylesheet.
          (node.isFolder && node.row ? " sb-nav-dual" : "") +
          (selected ? " sb-nav-selected" : "") +
          (dropTarget === node.path ? " sb-nav-droptarget" : "") +
          (node.row?.cssClass ? ` ${node.row.cssClass}` : "")
        }
        style={{ paddingLeft: `${depth * 1.2}rem` }}
        data-path={node.path}
        draggable={draggable}
        onClick={() => onSelect(node)}
      >
        {node.isFolder ? (
          <span
            class="sb-nav-chevron"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path);
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
        <span class="sb-nav-primary">
          {/* The row's own label wins over the path segment, for a view whose
              hierarchy is synthesized and whose paths carry escaping the
              reader must never see -- see `Row.label`. */}
          {highlightMatches(node.row?.label ?? node.segment, phrase)}
        </span>
        {node.row?.description && (
          <span class="sb-nav-description">{node.row.description}</span>
        )}
        {decorations.map((d, i) => (
          <Chip key={i} decoration={d} />
        ))}
        {actions && (selected || hovered) && (
          <RowActions
            actions={actions}
            icons={actionIcons}
            mask={state?.actions}
            readOnly={readOnly}
            onRun={(actionIndex) => onAction(node, actionIndex)}
          />
        )}
      </div>
      {isExpanded && (
        <ul role="group">
          {node.children.map((c) => (
            <TreeItem
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              selectedPath={selectedPath}
              hover={hover}
              dropTarget={dropTarget}
              draggable={draggable}
              phrase={phrase}
              actions={actions}
              actionIcons={actionIcons}
              rowState={rowState}
              hasIcon={hasIcon}
              readOnly={readOnly}
              onToggle={onToggle}
              onSelect={onSelect}
              onAction={onAction}
              selectedRef={selectedRef}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
