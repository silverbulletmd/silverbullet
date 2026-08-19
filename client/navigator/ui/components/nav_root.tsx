import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { ResizeHandle } from "../../../../plug-api/ui/resize_handle.tsx";
import { revealInClosest } from "../../../../plug-api/ui/scroll.ts";
import { SegmentedControl } from "../../../../plug-api/ui/segmented_control.tsx";
import { nodeObject } from "../../../../plug-api/ui/tree_model.ts";
import { TreeView } from "../../../../plug-api/ui/tree_view.tsx";
import type { Client } from "../../../client.ts";
import { resize } from "../../navigator.ts";
import { createCommands } from "../commands.ts";
import { engineFor } from "../engine.ts";
import { useDerived } from "../hooks/use_derived.ts";
import { usePanelEvents } from "../hooks/use_panel_events.ts";
import { useSourceQuery } from "../hooks/use_source_query.ts";
import { handleKeyDown } from "../keyboard.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "../panel.ts";
import { resolvePrefix } from "../prefix.ts";
import { markSlotReady, type NavActivation } from "../slots.ts";
import { CreateRow } from "./create_row.tsx";
import { ListView } from "./list_view.tsx";

/**
 * The panel itself: the input state a view is browsed with, wired to the
 * pieces that act on it -- `usePanelEvents` (everything outside its own
 * keystrokes drives), `useDerived` (everything shown), `createCommands`
 * (everything done) and `handleKeyDown` (the one keyboard pipeline).
 */
export function NavRoot({
  slot,
  client,
  activation,
  mode,
}: {
  slot: string;
  client: Client;
  activation: NavActivation;
  /** The flex mode for a dock; the modal sizes to its own content. */
  mode?: number | string;
}) {
  const engine = engineFor(slot);
  const [view, setView] = useState<ActiveView | undefined>(undefined);
  const [bootError, setBootError] = useState<string | undefined>(undefined);
  const [phrase, setPhrase] = useState("");
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [dropdownValue, setDropdownValue] = useState<unknown>(undefined);
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
  const dropdownDirty = useRef(false);
  const expandedDirty = useRef(false);
  const lastQueried = useRef<string | undefined>(undefined);
  const displayed = useRef<string | undefined>(undefined);
  const handledToken = useRef<number | undefined>(undefined);
  const readySignaledToken = useRef<number | undefined>(undefined);

  const refs: SharedRefs = {
    view: viewRef,
    phrase: phraseRef,
    input: inputRef,
    interaction,
    returnTo,
    segmentDirty,
    dropdownDirty,
    expandedDirty,
    lastQueried,
    displayed,
    handledToken,
    readySignaledToken,
  };
  const set: PanelSetters = {
    setView,
    setBootError,
    setPhrase,
    setSegmentIndex,
    setDropdownValue,
    setSelectedIndex,
    setSelectedPath,
    setExpanded,
  };

  const publish = useCallback(() => {
    const state = engine.activeState();
    if (state) setView({ name: state.meta.name, ...state });
  }, []);

  const { readOnly, mobile, refresh } = usePanelEvents({
    slot,
    client,
    engine,
    activation,
    refs,
    set,
    publish,
  });

  // Paint-gated reveal (see `slots.ts`'s `paintReady`): once this activation
  // has *something* to show -- rows, an error, "no results", doesn't matter
  // which -- lift the modal that is being held invisible rather than reveal
  // it empty and let it grow. Only reached by a *fresh* load or a source
  // refresh, both of which genuinely change `view`/`bootError` -- a reopen of
  // an already-displayed view has its own, immediate signal from
  // `createActivate` instead. `readySignaledToken` is shared with that path,
  // so whichever reaches a given activation first is the one that counts.
  // A `useLayoutEffect`, not a plain one, so this fires before the browser's
  // next paint of the settled content, not after. Keyed on
  // `handledToken.current` via the ref rather than a dependency (it isn't
  // reactive state), read fresh each time `view`/`bootError` change, which is
  // what actually means "this activation rendered something".
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
    markSlotReady(slot, token);
  }, [view, bootError]);

  const derived = useDerived({
    engine,
    view,
    bootError,
    phrase,
    segmentIndex,
    dropdownValue,
    selectedIndex,
    selectedPath,
    expanded,
    readOnly,
  });

  // A phrase edit, a segment switch or a dropdown pick is a deliberate change
  // of what's on screen, so the list goes back to the top -- unlike a
  // refresh, which must leave scroll alone.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [phrase, segmentIndex, dropdownValue]);

  const loading = useSourceQuery({
    engine,
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
    engine,
    mobile,
    phrase,
    segmentIndex,
    derived,
    refs,
    set,
    refresh: () => refresh.current(),
  });

  const {
    segments,
    dropdownIndex,
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
    dropdownUnavailable,
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
  const noFilter = !!view?.meta.noFilter;

  // A drawer has no draggable edge, so it needs no room reserved beside its
  // scrollbar either -- the class that reserves it goes with the handle.
  const showResizer = isSidebar && !mobile;

  return (
    <div
      className={
        `sb-nav-root sb-nav-root-${slot}` +
        (showResizer ? " sb-nav-resizable" : "")
      }
      data-slot={slot}
      style={mode === undefined ? undefined : { flex: mode }}
      // The panel's whole keyboard contract depends on the input holding
      // focus (see commands.ts), so no mousedown anywhere in the panel may
      // move it. Exempt: the input itself (caret placement, drag-selection),
      // the select (must take focus to open natively), draggable tree rows
      // (a canceled mousedown cancels the drag itself in Firefox -- their
      // handlers hand focus back instead), and the body's scrollbar gutter
      // (never moves focus, and canceling can block native scrollbar drags).
      onMouseDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("input, select, [draggable='true']")) return;
        if (
          target === bodyRef.current &&
          (e.offsetX >= target.clientWidth || e.offsetY >= target.clientHeight)
        ) {
          return;
        }
        e.preventDefault();
      }}
    >
      <div className={`sb-nav-header${noFilter ? " sb-nav-no-filter" : ""}`}>
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
            placeholder={noFilter ? undefined : placeholder}
            // Invisible but focused (it is the panel's focus home), so it
            // can't be aria-hidden -- a name is what keeps a screen reader
            // oriented on it instead.
            aria-label={
              noFilter ? (view?.meta.label ?? view?.meta.title) : undefined
            }
            value={phrase}
            onInput={(e) => {
              // Whatever slipped past the keydown swallow (paste, IME) would
              // invisibly filter the rows of a filterless view.
              if (noFilter) {
                e.currentTarget.value = "";
                return;
              }
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
        {view?.meta.dropdown && (
          <select
            className="sb-select sb-nav-dropdown"
            aria-label={view.meta.dropdown.placeholder ?? "Filter"}
            // Options are addressed by index: an option's value need not be a
            // string, and the DOM attribute would flatten it into one.
            value={dropdownIndex >= 0 ? String(dropdownIndex) : ""}
            onChange={(e) => {
              const picked = e.currentTarget.value;
              cmd.pickDropdown(picked === "" ? -1 : Number(picked));
            }}
            // A dismissed select (Escape, click-away, re-picking the same
            // option) never fires onChange, so `pickDropdown`'s focus handback
            // never runs -- and Tab interception lives on the input, so focus
            // stranded here would let Tab walk out of the panel.
            onBlur={() => inputRef.current?.focus()}
          >
            {/* The built-in "All": no filtering. allLabel names it explicitly;
                absent that, it's always "All". */}
            <option value="">{view.meta.dropdown.allLabel ?? "All"}</option>
            {(view.dropdownOptions ?? []).map((o, i) => (
              <option key={i} value={String(i)}>
                {o.label}
              </option>
            ))}
          </select>
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
        {dropdownUnavailable && (
          <div className="sb-nav-notice">
            This selection is unavailable right now
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
              void cmd.runAction(index, nodeObject(node))
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
              if (row) void cmd.runAction(index, row.obj);
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
          onResize={(width, commit) => void resize({ slot, width, commit })}
        />
      )}
    </div>
  );
}
