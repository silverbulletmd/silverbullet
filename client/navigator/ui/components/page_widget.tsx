import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Client } from "../../../client.ts";
import {
  computeTreeDisplay,
  nodeObject,
} from "../../../../plug-api/ui/tree_model.ts";
import { TreeView } from "../../../../plug-api/ui/tree_view.tsx";
import { handle, loadContent } from "../../registry.ts";
import type { PageSlotView } from "../../page_slots.ts";
import {
  activateOnKey,
  type ContentState,
  contentOutcome,
  createLoadGate,
  createSettleTracker,
  isRowActivation,
  loadIdentity,
  rowsIdentity,
  settlesSlot,
  subscribeRefresh,
  treeKeyAction,
  visibleRows,
  widgetKind,
} from "../../page_widget_logic.ts";
import {
  ContentNode,
  CopyMarkdownButton,
  renderContentMarkdown,
} from "./content_view.tsx";
import { MarkdownText, type RenderedRow, renderRows } from "./row_markdown.tsx";
import { PageWidgetFrame, useCollapsed } from "./page_widget_frame.tsx";
import type { Row, ViewMeta } from "../../types.ts";

/**
 * A content view in a page dock: the markdown its `content` function returned,
 * rendered through the shared pipeline (so links navigate and task checkboxes
 * tick), plus a Copy button putting the markdown *source* on the clipboard --
 * the same affordance the inline Lua widget button bar has.
 */
function PageContentWidget({
  name,
  meta,
  slot,
  client,
  initialCollapsed,
  onSettled,
}: {
  name: string;
  meta: ViewMeta;
  slot: string;
  client: Client;
  initialCollapsed: boolean;
  onSettled: (name: string) => void;
}) {
  const [state, setState] = useState<ContentState | undefined>(undefined);
  const [collapsed, toggle] = useCollapsed(name, initialCollapsed, onSettled);

  // The identity of what is currently committed, so a `refreshOn` burst that
  // produces the same content again costs nothing beyond the fetch itself.
  const gate = useRef(createLoadGate());

  useEffect(() => {
    let live = true;
    const load = () => {
      void loadContent(name, { dock: slot })
        .then(async (result) => {
          if (!live) return;
          const identity = loadIdentity(result.error, result.markdown ?? "");
          if (!gate.current.shouldCommit(identity)) return;
          if (result.error !== undefined) {
            setState({ markdown: "", error: result.error });
            gate.current.committed(identity);
            return;
          }
          const markdown = result.markdown ?? "";
          const node = markdown.trim()
            ? await renderContentMarkdown(client, markdown)
            : undefined;
          if (!live) return;
          setState({ markdown, node });
          gate.current.committed(identity);
        })
        .catch((e) => {
          if (!live) return;
          console.error("navigator content view: render failed", e);
          setState({ markdown: "", error: e?.message ?? String(e) });
          gate.current.failed();
        });
    };
    load();
    const unsubscribe = subscribeRefresh(
      client.eventHook,
      meta.refreshOn ?? [],
      load,
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [name]);

  const outcome = contentOutcome(state);

  // Every terminal outcome reports -- errored, empty and ready alike. The slot
  // is waiting on all of them before it touches its height cache.
  useEffect(() => {
    if (settlesSlot(outcome)) onSettled(name);
  }, [state]);

  // Same contract as the row widget: nothing at all until the content is in,
  // and nothing at all when there is none -- no title bar, no chrome.
  if (outcome === "pending" || outcome === "empty") return null;

  const { markdown, node, error } = state!;
  return (
    <PageWidgetFrame
      name={name}
      meta={meta}
      slot={slot}
      modifier="sb-page-widget-content"
      error={error}
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      hasBody={!!node}
      tools={
        !error && <CopyMarkdownButton client={client} markdown={markdown} />
      }
    >
      {node && <ContentNode client={client} node={node} />}
    </PageWidgetFrame>
  );
}

function PageWidget({
  name,
  meta,
  slot,
  client,
  initialCollapsed,
  onSettled,
}: {
  name: string;
  meta: ViewMeta;
  slot: string;
  client: Client;
  initialCollapsed: boolean;
  onSettled: (name: string) => void;
}) {
  const [rows, setRows] = useState<RenderedRow[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [collapsed, toggle] = useCollapsed(name, initialCollapsed, onSettled);
  const gate = useRef(createLoadGate());
  const isTree = meta.mode === "tree";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const firstExpansion = useRef(true);
  useEffect(() => {
    if (firstExpansion.current) {
      firstExpansion.current = false;
      return;
    }
    onSettled(name);
  }, [expanded]);

  useEffect(() => {
    let live = true;
    const load = () => {
      void handle({
        view: name,
        hook: "rows",
        // `slot` is this view's resolved dock -- it only renders here because
        // `pageSlotViews` resolved it to this slot.
        args: { ctx: { phrase: "", dock: slot } },
      })
        .then(async (result) => {
          if (!live) return;
          const loadError =
            result && !Array.isArray(result) && result.error
              ? String(result.error)
              : undefined;
          const incoming: Row[] = Array.isArray(result) ? result : [];
          const identity = loadIdentity(
            loadError,
            loadError ? "" : rowsIdentity(incoming),
          );
          if (!gate.current.shouldCommit(identity)) return;
          if (loadError) {
            setError(loadError);
            setRows([]);
            gate.current.committed(identity);
            return;
          }
          // Markdown is rendered before the rows are committed, not after, so
          // the slot's settle still measures a finished widget -- and so a row
          // never paints its raw syntax and then reflows into rendered HTML.
          const rendered = await renderRows(client, incoming, isTree);
          if (!live) return;
          setError(undefined);
          setRows(rendered);
          // After the row render, for the same reason the content widget
          // records after its own: a throw here must leave nothing recorded.
          gate.current.committed(identity);
        })
        .catch((e) => {
          if (!live) return;
          setError(e?.message ?? String(e));
          setRows([]);
          gate.current.failed();
        });
    };
    load();
    const unsubscribe = subscribeRefresh(
      client.eventHook,
      meta.refreshOn ?? [],
      load,
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [name]);

  useEffect(() => {
    if (rows === undefined) return;
    onSettled(name);
  }, [rows, error]);

  if (rows === undefined) return null;
  if (rows.length === 0 && !error) return null;

  const { shown, more } = visibleRows(rows, meta.limit);
  const select = (obj: Record<string, any>) =>
    void handle({ view: name, hook: "select", args: { obj } });
  const display = isTree
    ? computeTreeDisplay(
        rows.map((r) => r.row),
        meta.hierarchy.separator,
        meta.foldersFirst,
        { expanded, expandAll: meta.expandAll === true },
      )
    : undefined;

  return (
    <PageWidgetFrame
      name={name}
      meta={meta}
      slot={slot}
      modifier={isTree ? "sb-page-widget-tree" : undefined}
      error={error}
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      hasBody={!error}
    >
      {display ? (
        <TreeView
          tree={display.tree}
          expanded={display.effectiveExpanded}
          showEmpty={false}
          separator={meta.hierarchy.separator}
          canDrag={false}
          hasIcon={false}
          readOnly
          // A page dock has no filter input to hold focus, so the rows are
          // focusable and take their own keys -- see `treeKeyAction`.
          focusableRows
          onRowKeyDown={(node, ev) => {
            const action = treeKeyAction(ev.key, {
              isFolder: node.isFolder,
              isExpanded: display.effectiveExpanded.has(node.path),
            });
            if (!action) return;
            ev.preventDefault();
            if (action === "select") select(nodeObject(node));
            else toggleExpanded(node.path);
          }}
          onToggle={toggleExpanded}
          onSelect={(node) => select(nodeObject(node))}
          onMove={() => {}}
          onAction={() => {}}
        />
      ) : (
        shown.map(({ row, primaryNode, descriptionNode }, i) => {
          const activate = () => select(row.obj);
          return (
            <div
              key={`${i}:${row.primary}`}
              className={
                "sb-nav-row sb-page-widget-row" +
                (row.cssClass ? ` ${row.cssClass}` : "")
              }
              role="button"
              tabIndex={0}
              onClick={(ev) => {
                // A link or checkbox in rendered markdown answers its own
                // click; the row must not navigate on top of it.
                if (isRowActivation(ev.target)) activate();
              }}
              onKeyDown={(ev) => activateOnKey(ev, activate)}
            >
              {primaryNode ? (
                <MarkdownText
                  node={primaryNode}
                  className="sb-nav-primary"
                  client={client}
                />
              ) : (
                <span className="sb-nav-primary">{row.primary}</span>
              )}
              {descriptionNode ? (
                <MarkdownText
                  node={descriptionNode}
                  className="sb-nav-description"
                  client={client}
                />
              ) : (
                row.description && (
                  <span className="sb-nav-description">{row.description}</span>
                )
              )}
            </div>
          );
        })
      )}
      {/* A tree is uncapped (above), so it never has a remainder. */}
      {!isTree && more > 0 && (
        <div className="sb-page-widget-more">{more} more</div>
      )}
    </PageWidgetFrame>
  );
}

export function PageSlotWidgets({
  views,
  slot,
  client,
  onSettled,
}: {
  views: PageSlotView[];
  slot: "page-top" | "page-bottom";
  client: Client;
  onSettled: (name: string) => void;
}) {
  return (
    <>
      {views.map((v) => {
        const Widget =
          widgetKind(v.meta) === "content" ? PageContentWidget : PageWidget;
        return (
          <Widget
            key={v.name}
            name={v.name}
            meta={v.meta}
            slot={slot}
            client={client}
            // Already resolved by `pageSlotViews`, alongside dock and open.
            initialCollapsed={v.collapsed}
            onSettled={onSettled}
          />
        );
      })}
    </>
  );
}

export function renderPageSlot(
  div: HTMLElement,
  views: PageSlotView[],
  slot: "page-top" | "page-bottom",
  client: Client,
  onAllSettled: () => void,
): void {
  const report = createSettleTracker(
    views.map((v) => v.name),
    onAllSettled,
  );
  render(
    <PageSlotWidgets
      views={views}
      slot={slot}
      client={client}
      onSettled={report}
    />,
    div,
  );
}

export function unmountPageSlot(div: HTMLElement): void {
  render(null, div);
}
