import { RowText } from "./row_text.tsx";
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

export function externalFilesDrag(
  types: readonly string[],
  enabled: boolean,
): boolean {
  return enabled && types.includes("Files") && !types.includes(DRAG_MIME);
}

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
    dragging.current = path;
    e.dataTransfer?.setData(DRAG_MIME, path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
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
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag || onExternalFiles ? onDragOver : undefined}
      onDragLeave={canDrag || onExternalFiles ? onDragLeave : undefined}
      onDrop={canDrag || onExternalFiles ? onDrop : undefined}
      onDragEnd={canDrag || onExternalFiles ? endDrag : undefined}
      onPointerOver={(e) => hover.track(e, pathAt)}
      onPointerLeave={() => hover.set(undefined)}
    >
      {dropTarget !== undefined && onExternalFiles && !dragging.current && (
        <li role="presentation" class="sb-nav-upload-target">
          <span>Upload to {dropTarget || "Space root"}</span>
        </li>
      )}
      {tree.children.map((n) => (
        <TreeItem
          key={n.path}
          node={n}
          depth={0}
          expanded={expanded}
          selectedPath={selectedPath}
          currentPath={currentPath}
          hover={hover}
          dropTarget={dropTarget}
          draggable={canDrag}
          phrase={phrase}
          actions={actions}
          actionIcons={actionIcons}
          documentActions={documentActions}
          actionsDisabled={actionsDisabled}
          rowState={rowState}
          hasIcon={hasIcon}
          readOnly={readOnly}
          onToggle={onToggle}
          onSelect={onSelect}
          onAction={onAction}
          selectedRef={selectedRef}
          focusableRows={focusableRows}
          onRowKeyDown={onRowKeyDown}
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
  currentPath,
  hover,
  dropTarget,
  draggable,
  phrase,
  actions,
  actionIcons,
  documentActions,
  actionsDisabled,
  rowState,
  hasIcon,
  readOnly,
  onToggle,
  onSelect,
  onAction,
  selectedRef,
  focusableRows,
  onRowKeyDown,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedPath?: string;
  currentPath?: string;
  hover: HoverTracker;
  dropTarget?: string;
  draggable: boolean;
  phrase?: string;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  documentActions?: boolean;
  actionsDisabled?: boolean;
  rowState?: RowStates;
  hasIcon: boolean;
  readOnly: boolean;
  onToggle: (path: string) => void;
  onSelect?: (node: TreeNode) => void;
  onAction: (node: TreeNode, actionIndex: number) => void;
  selectedRef: { current: HTMLDivElement | null };
  focusableRows?: boolean;
  onRowKeyDown?: (node: TreeNode, event: KeyboardEvent) => void;
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
          (node.isFolder ? " sb-nav-folder" : "") +
          (node.isFolder && node.row ? " sb-nav-dual" : "") +
          (selected ? " sb-nav-selected" : "") +
          (!onSelect && !node.isFolder ? " sb-nav-passive" : "") +
          (dropTarget === node.path ? " sb-nav-droptarget" : "") +
          (node.row?.cssClass ? ` ${node.row.cssClass}` : "")
        }
        style={{
          paddingLeft: `calc(var(--sb-tree-row-inset, 0px) + ${depth} * var(--sb-tree-indent, 1.2rem))`,
        }}
        data-path={node.path}
        aria-current={currentPath === node.path ? "page" : undefined}
        draggable={draggable}
        tabIndex={focusableRows ? 0 : undefined}
        onKeyDown={
          onRowKeyDown
            ? (e) => onRowKeyDown(node, e as KeyboardEvent)
            : undefined
        }
        onClick={
          onSelect || node.isFolder
            ? () => activateTreeRow(node, onSelect, onToggle)
            : undefined
        }
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
              currentPath={currentPath}
              hover={hover}
              dropTarget={dropTarget}
              draggable={draggable}
              phrase={phrase}
              actions={actions}
              actionIcons={actionIcons}
              documentActions={documentActions}
              actionsDisabled={actionsDisabled}
              rowState={rowState}
              hasIcon={hasIcon}
              readOnly={readOnly}
              onToggle={onToggle}
              onSelect={onSelect}
              onAction={onAction}
              selectedRef={selectedRef}
              focusableRows={focusableRows}
              onRowKeyDown={onRowKeyDown}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
