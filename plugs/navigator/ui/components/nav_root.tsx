import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { ResizeHandle } from "../../../../plug-api/ui/resize_handle.tsx";
import { SegmentedControl } from "../../../../plug-api/ui/segmented_control.tsx";
import { revealInClosest } from "../../../../plug-api/ui/scroll.ts";
import { nodeObject } from "../../../../plug-api/ui/tree_model.ts";
import { TreeView } from "../../../../plug-api/ui/tree_view.tsx";
import { createCommands } from "../commands.ts";
import { dispatch } from "../engine.ts";
import { useDerived } from "../hooks/use_derived.ts";
import { usePanelEvents } from "../hooks/use_panel_events.ts";
import { useSourceQuery } from "../hooks/use_source_query.ts";
import { handleKeyDown } from "../keyboard.ts";
import {
  type ActiveView,
  engine,
  type PanelSetters,
  type SharedRefs,
} from "../panel.ts";
import { resolvePrefix } from "../prefix.ts";
import { CreateRow } from "./create_row.tsx";
import { ListView } from "./list_view.tsx";

/**
 * The panel itself: the input state a view is browsed with, wired to the
 * pieces that act on it -- `usePanelEvents` (everything the host drives),
 * `useDerived` (everything shown), `createCommands` (everything done) and
 * `handleKeyDown` (the one keyboard pipeline).
 *
 * The singletons all of them share -- the engine, and the hook slots the
 * host's `sbEvent` subscriptions forward into -- live in `panel.ts`, which
 * documents why they hang off globalThis rather than off a module.
 */
export function NavRoot({ slot }: { slot: string }) {
  const [view, setView] = useState<ActiveView | undefined>(undefined);
  const [bootError, setBootError] = useState<string | undefined>(undefined);
  const [phrase, setPhrase] = useState("");
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    undefined,
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<"typing" | "navigating">("typing");
  // Kept current every render so the handlers registered once per slot can
  // read the latest view and phrase without re-registering.
  const viewRef = useRef<ActiveView | undefined>(undefined);
  viewRef.current = view;
  const phraseRef = useRef("");
  phraseRef.current = phrase;
  const returnTo = useRef<string | undefined>(undefined);
  const segmentDirty = useRef(false);
  const expandedDirty = useRef(false);
  const lastQueried = useRef<string | undefined>(undefined);

  const refs: SharedRefs = {
    view: viewRef,
    phrase: phraseRef,
    input: inputRef,
    interaction,
    returnTo,
    segmentDirty,
    expandedDirty,
    lastQueried,
  };
  const set: PanelSetters = {
    setView,
    setBootError,
    setPhrase,
    setSegmentIndex,
    setSelectedIndex,
    setSelectedPath,
    setExpanded,
  };

  const publish = useCallback(() => {
    const state = engine.activeState();
    if (state) setView({ name: state.meta.name, ...state });
  }, []);

  const { readOnly, mobile, displayed, handledToken, readySignaledToken } =
    usePanelEvents({
      slot,
      refs,
      set,
      publish,
    });

  // Paint-gated reveal handshake (see `editor.showPanel`'s `paintReady`):
  // once this activation has *something* to show -- rows, an error, "no
  // results", doesn't matter which -- tell the host, so it can lift a modal
  // it's holding invisible rather than reveal it empty and let it grow. Only
  // reached by a *fresh* load or a source refresh, both of which genuinely
  // change `view`/`bootError` -- a reopen of an already-displayed view has
  // its own, immediate signal from `createActivate` instead (nothing here
  // would ever change for it to react to). `readySignaledToken` is shared
  // with that path, so whichever of the two reaches a given activation first
  // is the one that counts.
  // A `useLayoutEffect`, not a plain one, so this fires before the browser's
  // next paint of the settled content, not after -- the host would otherwise
  // still catch a frame of the (already-real, already grown) DOM unrevealed
  // for no reason. Keyed on `handledToken.current` via the ref rather than a
  // dependency (it isn't reactive state), read fresh each time `view`/
  // `bootError` change, which is what actually means "this activation
  // rendered something".
  useLayoutEffect(() => {
    const token = handledToken.current;
    if (
      token === undefined ||
      token === readySignaledToken.current ||
      (view === undefined && bootError === undefined)
    ) {
      return;
    }
    readySignaledToken.current = token;
    void syscall("editor.panelReady", slot, token);
  }, [view, bootError]);

  const derived = useDerived({
    view,
    bootError,
    phrase,
    segmentIndex,
    selectedIndex,
    selectedPath,
    expanded,
    readOnly,
  });

  // A phrase edit or a segment switch is a deliberate change of what's on
  // screen, so the list goes back to the top -- unlike a refresh, which must
  // leave scroll alone.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [phrase, segmentIndex]);

  const loading = useSourceQuery({
    view,
    sourceMode: derived.sourceMode,
    phrase,
    segments: derived.segments,
    segmentIndex,
    refs,
    set,
    publish,
  });

  // The create row isn't part of ListView, so nothing else reveals it, and in
  // list mode (unlike tree mode) it isn't sticky either -- with enough
  // matches, End would select it off-screen.
  useEffect(() => {
    if (derived.createSelected) {
      revealInClosest(createRef.current, ".sb-nav-body");
    }
  }, [derived.createSelected]);

  const cmd = createCommands({
    slot,
    view,
    mobile,
    phrase,
    segmentIndex,
    derived,
    refs,
    set,
    displayed,
    handledToken,
  });

  const {
    segments,
    rankPhrase,
    trimmedPhrase,
    listItems,
    activeIndex,
    createIndex,
    createSelected,
    canCreate,
    canDrag,
    error,
    fatalError,
    segmentUnavailable,
    isTreeMode,
    treeFiltering,
    treeDisplay,
    activeTreeNode,
    truncated,
  } = derived;

  const isSidebar = slot !== "modal";
  // A verb where the title goes, and a placeholder naming what is being
  // picked -- which follows the segment, so the same view reads as "Page",
  // "Meta page" or "Document" depending on which subset is active.
  const placeholder =
    segments?.[segmentIndex]?.placeholder ?? view?.meta.placeholder ?? "Filter";

  // A drawer has no draggable edge, so it needs no room reserved beside its
  // scrollbar either -- the class that reserves it goes with the handle.
  const showResizer = isSidebar && !mobile;

  return (
    <div
      className={
        "sb-nav-root" +
        (showResizer ? ` sb-nav-root-${slot}` : "") +
        (slot === "modal" ? " sb-nav-root-modal" : "")
      }
    >
      <div className="sb-nav-header">
        <div className="sb-nav-header-row">
          {view && (
            <label className="sb-nav-title">
              {view.meta.label ?? view.meta.title}
            </label>
          )}
          <input
            ref={inputRef}
            className="sb-nav-input"
            type="text"
            placeholder={placeholder}
            value={phrase}
            onInput={(e) => {
              interaction.current = "typing";
              const value = e.currentTarget.value;
              // Prefix routing, resolved on the input rather than the keydown
              // so a paste ("$anchor" straight into an empty box) routes just
              // like a typed character does.
              const routed = resolvePrefix(view?.meta, phrase, value);
              if (routed) {
                // Both halves, deliberately. The state write is what the panel
                // renders from; the DOM write is because `phrase` may not
                // change at all here (empty to empty), and preact then has no
                // re-render in which to take the prefix character back out of
                // the box the browser already put it in.
                e.currentTarget.value = routed.rest;
                setPhrase(routed.rest);
                setSelectedIndex(0);
                setSelectedPath(undefined);
                if (routed.kind === "view") {
                  cmd.routeToView(routed.view, routed.rest, view?.name);
                } else {
                  cmd.pickSegment(routed.index);
                }
                return;
              }
              setPhrase(value);
              setSelectedIndex(0);
              setSelectedPath(undefined);
            }}
            onKeyDown={(e) =>
              handleKeyDown(e, {
                view,
                phrase,
                segmentIndex,
                interaction,
                derived,
                cmd,
                set,
              })
            }
          />
          {loading && (
            <span
              className="sb-nav-spinner"
              role="status"
              aria-label="Searching"
            />
          )}
          {isSidebar && (
            <button
              type="button"
              className="sb-nav-close"
              aria-label="Close"
              onClick={() => void cmd.close()}
            >
              ×
            </button>
          )}
        </div>
        {segments && (
          <SegmentedControl
            items={segments.map((s, i) => ({
              label: s.label,
              icon: view?.segmentIcons?.[i],
              // A prefix is never on screen, so it is always worth saying;
              // the icons-only fallback (labels as tooltip when collapsed)
              // is the shared control's own concern.
              tooltip: s.prefix ? `${s.label} (${s.prefix})` : undefined,
            }))}
            activeIndex={segmentIndex}
            onPick={cmd.pickSegment}
            ariaLabel="Segments"
          />
        )}
      </div>
      <div className="sb-nav-body" ref={bodyRef}>
        {error && !fatalError && (
          <div className="sb-nav-error sb-nav-error-inline">{error}</div>
        )}
        {segmentUnavailable && (
          <div className="sb-nav-notice">
            This segment is unavailable right now
          </div>
        )}
        {fatalError ? (
          <div className="sb-nav-error">{error}</div>
        ) : view && isTreeMode && treeDisplay ? (
          <TreeView
            tree={treeDisplay.tree}
            expanded={treeDisplay.effectiveExpanded}
            selectedPath={activeTreeNode?.path}
            phrase={treeFiltering ? rankPhrase : undefined}
            showEmpty={!canCreate}
            separator={view.meta.hierarchy.separator}
            canDrag={canDrag}
            actions={view.meta.actions}
            actionIcons={view.actionIcons}
            rowState={view.rowState}
            hasIcon={!!view.meta.hasRowIcon}
            readOnly={readOnly}
            scrollContainerSelector=".sb-nav-body"
            onToggle={cmd.toggleExpanded}
            onSelect={cmd.onTreeRowClick}
            onMove={(from, to) => void cmd.moveNode(from, to)}
            onAction={(node, index) =>
              void cmd.runAction(
                index,
                nodeObject(node),
                node.row?.primary ?? node.path,
              )
            }
          />
        ) : view ? (
          <ListView
            rows={listItems}
            selectedIndex={activeIndex}
            showEmpty={!canCreate}
            actions={view.meta.actions}
            actionIcons={view.actionIcons}
            rowState={view.rowState}
            hasIcon={!!view.meta.hasRowIcon}
            readOnly={readOnly}
            phrase={trimmedPhrase ? rankPhrase : undefined}
            createRow={
              createIndex < 0
                ? undefined
                : (selected) => (
                    <CreateRow
                      phrase={trimmedPhrase}
                      icon={view.createIcon}
                      hasIcon={!!view.meta.hasRowIcon}
                      selected={selected}
                      elRef={selected ? createRef : undefined}
                      onClick={() => void cmd.runCreate()}
                    />
                  )
            }
            onSelect={(i) => void cmd.selectRow(i)}
            onAction={(i, index) => {
              const row = listItems[i]?.row;
              if (row) void cmd.runAction(index, row.obj, row.primary);
            }}
          />
        ) : null}
        {truncated > 0 && !fatalError && (
          <div className="sb-nav-row sb-nav-more">
            {truncated} more {truncated === 1 ? "match" : "matches"} — keep
            typing
          </div>
        )}
        {/* A tree pins its create row below the whole tree: there is no
            "second row" in a hierarchy, and splicing one between a folder and
            its children would read as a child of it. A list splices it in at
            index 1 instead -- see `createIndex`. */}
        {canCreate && isTreeMode && !fatalError && (
          <CreateRow
            phrase={trimmedPhrase}
            icon={view?.createIcon}
            hasIcon={!!view?.meta.hasRowIcon}
            selected={createSelected}
            pinned
            elRef={createRef}
            onClick={() => void cmd.runCreate()}
          />
        )}
      </div>
      {/* A drawer is the full width of the screen: there is no edge to drag,
          and the handle would only sit over the first column of every row. */}
      {showResizer && (
        <ResizeHandle
          slot={slot as "lhs" | "rhs"}
          onResize={(width, commit) =>
            // `view?.name` is the view this panel is live showing (accurate
            // across a route() hop too) -- lets the backend recover after its
            // own module state is wiped without trusting a possibly-stale
            // datastore entry. See navigator.ts's `resize`.
            void dispatch("navigator:resize", {
              slot,
              width,
              commit,
              view: view?.name,
            })
          }
        />
      )}
    </div>
  );
}
