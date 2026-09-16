import { render } from "preact";
import { useCallback } from "preact/hooks";
import type { Client } from "../../../client.ts";
import { handle } from "../../registry.ts";
import type { PageSlotView } from "../../page_slots.ts";
import { createSettleTracker } from "../../page_widget_logic.ts";
import { DocumentView, type DocumentDispatch } from "./document_view.tsx";
import { useCollapsed } from "./page_widget_frame.tsx";

function PageDocument({
  view,
  slot,
  client,
  onSettled,
}: {
  view: PageSlotView;
  slot: "page-top" | "page-bottom";
  client: Client;
  onSettled: (name: string) => void;
}) {
  const { name, meta, collapsed: initialCollapsed } = view;
  const [collapsed, toggle] = useCollapsed(name, initialCollapsed, (name) =>
    onSettled(name),
  );
  const dispatch: DocumentDispatch = useCallback(
    (hook, args) => handle({ view: name, hook, args }),
    [name],
  );
  return (
    <DocumentView
      meta={meta}
      client={client}
      pageName={client.currentName()}
      dock={slot}
      dispatch={dispatch}
      selectable={meta.hasSelect !== false}
      frame={{
        name,
        slot,
        collapsed,
        onToggleCollapsed: toggle,
        onSettled,
      }}
    />
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
      {views.map((view) => (
        <PageDocument
          key={view.name}
          view={view}
          slot={slot}
          client={client}
          onSettled={onSettled}
        />
      ))}
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
    views.map((view) => view.name),
    () => {
      if (!div.querySelector('[aria-busy="true"]')) onAllSettled();
    },
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
