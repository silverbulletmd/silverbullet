import { datastore } from "@silverbulletmd/silverbullet/syscalls";
import { RowText } from "../../../../plug-api/ui/row_text.tsx";
import {
  computeTreeDisplay,
  nodeObject,
} from "../../../../plug-api/ui/tree_model.ts";
import { TreeView } from "../../../../plug-api/ui/tree_view.tsx";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Client } from "../../../client.ts";
import {
  activateOnKey,
  type ContentState,
  contentOutcome,
  createLoadGate,
  isRowActivation,
  loadIdentity,
  rowsIdentity,
  settlesSlot,
  subscribeRefresh,
  treeKeyAction,
  visibleRows,
  widgetKind,
} from "../../page_widget_logic.ts";
import { normalizeContent } from "../../registry.ts";
import type { Row, ViewMeta } from "../../types.ts";
import { createInlineExpansion } from "../expansion.ts";
import { useLoading } from "../hooks/use_loading.ts";
import { LoadingState } from "../loading.ts";
import {
  ContentNode,
  CopyMarkdownButton,
  renderContentMarkdown,
} from "./content_view.tsx";
import { PageWidgetFrame } from "./page_widget_frame.tsx";
import { LoadingIndicator } from "./loading_indicator.tsx";
import { MarkdownText, type RenderedRow, renderRows } from "./row_markdown.tsx";

export type DocumentDispatch = (
  hook: "rows" | "content" | "select",
  args: { ctx?: { phrase: string; dock: string }; obj?: Record<string, any> },
) => Promise<any>;

export type PageDocumentFrame = {
  name: string;
  slot: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSettled: (name: string) => void;
};

type DocumentProps = {
  meta: ViewMeta;
  client: Client;
  pageName: string;
  dock: string;
  dispatch: DocumentDispatch;
  selectable: boolean;
  persistenceKey?: string[];
  frame?: PageDocumentFrame;
};

export function DocumentView(props: DocumentProps) {
  return widgetKind(props.meta) === "content" ? (
    <DocumentContent {...props} />
  ) : (
    <DocumentRows {...props} />
  );
}

function InlineBody({
  pending,
  loading,
  error,
  children,
}: {
  pending: boolean;
  loading: boolean;
  error?: string;
  children?: preact.ComponentChildren;
}) {
  return (
    <div className="sb-inline-view-body" aria-busy={pending}>
      {loading && (
        <div className="sb-inline-view-loading">
          <LoadingIndicator />
        </div>
      )}
      {error && (
        <div className="sb-nav-error sb-nav-error-inline" role="alert">
          {error}
        </div>
      )}
      {!error && children}
    </div>
  );
}

function DocumentContent({
  meta,
  client,
  pageName,
  dock,
  dispatch,
  frame,
}: DocumentProps) {
  const [state, setState] = useState<ContentState | undefined>();
  const [loading] = useState(() => new LoadingState());
  const { pending, visible } = useLoading(loading);
  const gate = useRef(createLoadGate());

  useEffect(() => {
    let live = true;
    const load = () => {
      const ticket = loading.begin();
      void dispatch("content", { ctx: { phrase: "", dock } })
        .then(async (raw) => {
          if (!live || !ticket.isCurrent()) return;
          const result = normalizeContent(raw);
          const identity = loadIdentity(result.error, result.markdown ?? "");
          if (!gate.current.shouldCommit(identity)) return;
          if (result.error !== undefined) {
            setState({ markdown: "", error: result.error });
            gate.current.committed(identity);
            return;
          }
          const markdown = result.markdown ?? "";
          const node = markdown.trim()
            ? await renderContentMarkdown(client, markdown, pageName)
            : undefined;
          if (!live || !ticket.isCurrent()) return;
          setState({ markdown, node });
          gate.current.committed(identity);
        })
        .catch((error) => {
          if (!live || !ticket.isCurrent()) return;
          console.error("navigator content view: render failed", error);
          setState({ markdown: "", error: error?.message ?? String(error) });
          gate.current.failed();
        })
        .finally(ticket.finish);
    };
    load();
    const unsubscribe = subscribeRefresh(
      client.eventHook,
      meta.refreshOn ?? [],
      load,
    );
    return () => {
      live = false;
      loading.cancel();
      unsubscribe();
    };
  }, [dispatch, dock, pageName]);

  const outcome = contentOutcome(state);
  useEffect(() => {
    if (frame && !pending && settlesSlot(outcome)) frame.onSettled(frame.name);
  }, [state, pending]);

  if (!frame) {
    return (
      <InlineBody
        pending={pending || outcome === "pending"}
        loading={visible}
        error={state?.error}
      >
        {state?.node && <ContentNode client={client} node={state.node} />}
      </InlineBody>
    );
  }
  if (outcome === "pending" || outcome === "empty") return null;
  const { markdown = "", node, error } = state ?? {};
  return (
    <PageWidgetFrame
      name={frame.name}
      meta={meta}
      slot={frame.slot}
      modifier="sb-page-widget-content"
      error={error}
      pending={pending}
      loading={visible}
      collapsed={frame.collapsed}
      onToggleCollapsed={frame.onToggleCollapsed}
      hasBody={!!node}
      tools={
        node &&
        !error && <CopyMarkdownButton client={client} markdown={markdown} />
      }
    >
      {node && <ContentNode client={client} node={node} />}
    </PageWidgetFrame>
  );
}

export function DocumentRowsBody({
  rows,
  meta,
  client,
  expanded,
  onToggle,
  onSelect,
}: {
  rows: RenderedRow[];
  meta: ViewMeta;
  client: Client;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect?: (obj: Record<string, any>) => void;
}) {
  const isTree = meta.mode === "tree";
  const { shown, more } = visibleRows(rows, meta.limit);
  const display = isTree
    ? computeTreeDisplay(
        rows.map((entry) => entry.row),
        meta.hierarchy.separator,
        meta.foldersFirst,
        { expanded, expandAll: meta.expandAll === true },
      )
    : undefined;
  return (
    <>
      {display ? (
        <TreeView
          tree={display.tree}
          expanded={display.effectiveExpanded}
          showEmpty={false}
          separator={meta.hierarchy.separator}
          canDrag={false}
          hasIcon={false}
          readOnly
          focusableRows
          onRowKeyDown={(node, event) => {
            const action = treeKeyAction(event.key, {
              isFolder: node.isFolder,
              isExpanded: display.effectiveExpanded.has(node.path),
            });
            if (!action) return;
            if (action === "select" && !onSelect && !node.isFolder) return;
            event.preventDefault();
            if (action === "select" && onSelect) onSelect(nodeObject(node));
            else onToggle(node.path);
          }}
          onToggle={onToggle}
          onSelect={onSelect ? (node) => onSelect(nodeObject(node)) : undefined}
          onMove={() => {}}
          onAction={() => {}}
        />
      ) : (
        shown.map(({ row, primaryNode, descriptionNode }, index) => {
          const activate = () => onSelect?.(row.obj);
          return (
            <div
              key={`${index}:${row.primary}`}
              className={
                "sb-nav-row sb-page-widget-row" +
                (onSelect ? "" : " sb-nav-passive") +
                (row.cssClass ? ` ${row.cssClass}` : "")
              }
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={
                onSelect
                  ? (event) => {
                      if (isRowActivation(event.target)) activate();
                    }
                  : undefined
              }
              onKeyDown={
                onSelect ? (event) => activateOnKey(event, activate) : undefined
              }
            >
              <RowText
                primary={
                  primaryNode ? (
                    <MarkdownText
                      node={primaryNode}
                      className="sb-nav-primary"
                      client={client}
                    />
                  ) : (
                    <span className="sb-nav-primary">{row.primary}</span>
                  )
                }
                description={row.description}
                renderedDescription={
                  descriptionNode ? (
                    <MarkdownText
                      node={descriptionNode}
                      className="sb-nav-description"
                      client={client}
                    />
                  ) : undefined
                }
              />
            </div>
          );
        })
      )}
      {!isTree && more > 0 && (
        <div className="sb-page-widget-more">{more} more</div>
      )}
    </>
  );
}

function DocumentRows({
  meta,
  client,
  pageName,
  dock,
  dispatch,
  selectable,
  persistenceKey,
  frame,
}: DocumentProps) {
  const [rows, setRows] = useState<RenderedRow[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading] = useState(() => new LoadingState());
  const { pending, visible } = useLoading(loading);
  const [version, setVersion] = useState(0);
  const [expansion] = useState(() =>
    createInlineExpansion(
      persistenceKey,
      {
        get: (key) => datastore.get(key),
        set: (key, value) => datastore.set(key, value),
      },
      () => setVersion((previous) => previous + 1),
    ),
  );
  const gate = useRef(createLoadGate());
  const firstExpansion = useRef(true);

  useEffect(() => {
    void expansion.load();
    return () => expansion.dispose();
  }, [expansion]);

  useEffect(() => {
    if (firstExpansion.current) {
      firstExpansion.current = false;
      return;
    }
    if (frame && !loading.pending) frame.onSettled(frame.name);
  }, [version]);

  useEffect(() => {
    let live = true;
    const load = () => {
      const ticket = loading.begin();
      void dispatch("rows", { ctx: { phrase: "", dock } })
        .then(async (result) => {
          if (!live || !ticket.isCurrent()) return;
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
          const rendered = await renderRows(
            client,
            incoming,
            meta.mode === "tree",
            pageName,
          );
          if (!live || !ticket.isCurrent()) return;
          setError(undefined);
          setRows(rendered);
          gate.current.committed(identity);
        })
        .catch((cause) => {
          if (!live || !ticket.isCurrent()) return;
          setError(cause?.message ?? String(cause));
          setRows([]);
          gate.current.failed();
        })
        .finally(ticket.finish);
    };
    load();
    const unsubscribe = subscribeRefresh(
      client.eventHook,
      meta.refreshOn ?? [],
      load,
    );
    return () => {
      live = false;
      loading.cancel();
      unsubscribe();
    };
  }, [dispatch, dock, pageName]);

  useEffect(() => {
    if (frame && !pending && rows !== undefined) frame.onSettled(frame.name);
  }, [rows, error, pending]);

  const body =
    rows?.length && expansion.ready && !error ? (
      <DocumentRowsBody
        rows={rows}
        meta={meta}
        client={client}
        expanded={expansion.expanded}
        onToggle={(path) => expansion.toggle(path)}
        onSelect={
          selectable ? (obj) => void dispatch("select", { obj }) : undefined
        }
      />
    ) : undefined;
  if (!frame) {
    return (
      <InlineBody
        pending={pending || rows === undefined || !expansion.ready}
        loading={visible}
        error={error}
      >
        {body}
      </InlineBody>
    );
  }
  if (!error && !rows?.length) return null;
  return (
    <PageWidgetFrame
      name={frame.name}
      meta={meta}
      slot={frame.slot}
      modifier={meta.mode === "tree" ? "sb-page-widget-tree" : undefined}
      error={error}
      pending={pending}
      loading={visible}
      collapsed={frame.collapsed}
      onToggleCollapsed={frame.onToggleCollapsed}
      hasBody={!error && !!rows?.length}
    >
      {body}
    </PageWidgetFrame>
  );
}
