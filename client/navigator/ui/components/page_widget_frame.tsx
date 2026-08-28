import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { closeView, setViewCollapsed } from "../../navigator.ts";
import {
  activateOnKey,
  showsBody,
  toggleCollapsed,
} from "../../page_widget_logic.ts";
import type { ViewMeta } from "../../types.ts";
import { CloseIcon } from "./chrome_icons.tsx";
import { DockMenu } from "./dock_menu.tsx";

/**
 * The strip above a page widget: a collapse triangle and its title on the left,
 * whatever tools it contributes plus the dock menu and × on the right. Shared
 * by both kinds of widget so a content view and a row view are framed
 * identically.
 *
 * This component is what makes collapse *page-docked only* with no
 * special-casing: a sidebar or the modal builds its own header in
 * `nav_root.tsx` and never comes through here.
 */
function WidgetBar({
  name,
  meta,
  slot,
  error,
  tools,
  collapsed,
  onToggleCollapsed,
}: {
  name: string;
  meta: ViewMeta;
  slot: string;
  error?: string;
  tools?: ComponentChildren;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const label = meta.label ?? meta.title;
  return (
    <div
      className="sb-page-widget-bar"
      title={error ? `Error: ${error}` : undefined}
    >
      <span className="sb-page-widget-heading">
        <button
          type="button"
          className="sb-page-widget-fold"
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          onClick={onToggleCollapsed}
        >
          ▾
        </button>
        {/* `.sb-nav-title` is the panel header's own label class, so the
            title reads identically in every dock; only the strip around it
            belongs to the page widget. The title doubles as the fold's
            larger click target -- it carried no behaviour of its own, so
            nothing is swallowed to get it. */}
        <span
          className="sb-nav-title sb-page-widget-title"
          role="button"
          tabIndex={0}
          onClick={onToggleCollapsed}
          onKeyDown={(ev) => activateOnKey(ev, onToggleCollapsed)}
        >
          {label}
          {error && <span className="sb-page-widget-error"> ⚠</span>}
        </span>
      </span>
      <span className="sb-page-widget-tools">
        {tools}
        <DockMenu
          name={name}
          current={slot}
          supported={meta.supportedDocks ?? [slot]}
        />
        <button
          type="button"
          className="sb-nav-close"
          title="Close"
          aria-label="Close"
          onClick={() => void closeView(name, slot)}
        >
          <CloseIcon />
        </button>
      </span>
    </div>
  );
}

/**
 * The collapse state a page widget runs on: seeded from what `pageSlotViews`
 * already read (never fetched after mount, which would paint expanded and then
 * roll up), flipped and persisted together, and reported to the slot so its
 * height cache re-measures rather than keeping the body's height.
 */
export function useCollapsed(
  name: string,
  initial: boolean,
  onSettled: (name: string) => void,
): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(initial);
  const first = useRef(true);

  // Not on mount: the widget's own load path reports that settle, and
  // reporting here as well would measure before there is a body to measure.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onSettled(name);
  }, [collapsed]);

  return [
    collapsed,
    () => {
      const { next, persist } = toggleCollapsed(collapsed);
      // Persisted *before* the flip, the way `closeView` and the dock menu
      // persist before their own UI moves. Flipping first and writing in the
      // background loses the write outright if the user navigates in the same
      // breath -- the page tears down the in-flight write, and the widget
      // comes back expanded with nothing to say why.
      void setViewCollapsed(name, persist)
        .then(() => setCollapsed(next))
        // A datastore that won't take the write is not a reason to eat the
        // click: flip anyway so the toggle stays responsive, and say why the
        // state won't survive a reload rather than raising an unhandled
        // rejection nobody sees.
        .catch((e) => {
          console.error("navigator: could not persist collapse state", e);
          setCollapsed(next);
        });
    },
  ];
}

/**
 * What a page-docked view looks like from the outside, whichever kind it is:
 * the wrapper, the bar, and the body when there is one to draw. The two widget
 * kinds differ only in what they load and what they put in the body -- keeping
 * the frame here is what stops a content view and a row view from drifting
 * apart in their chrome.
 *
 * `hasBody` rather than a pre-gated `children`, so the collapse rule lives in
 * exactly one place: collapsed *removes* the body rather than hiding it, which
 * is what lets the slot re-measure to the bar's own height.
 */
export function PageWidgetFrame({
  name,
  meta,
  slot,
  modifier,
  error,
  tools,
  collapsed,
  onToggleCollapsed,
  hasBody,
  children,
}: {
  name: string;
  meta: ViewMeta;
  slot: string;
  /** An extra class beside `sb-page-widget`, e.g. `sb-page-widget-tree`. */
  modifier?: string;
  error?: string;
  tools?: ComponentChildren;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  hasBody: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div
      className={[
        "sb-page-widget",
        modifier,
        collapsed && "sb-page-widget-collapsed",
      ]
        .filter(Boolean)
        .join(" ")}
      data-view={name}
      // Focusable programmatically (never by Tab): `open()` focuses the widget
      // when it has no row to hand the keyboard to.
      tabIndex={-1}
    >
      <WidgetBar
        name={name}
        meta={meta}
        slot={slot}
        error={error}
        tools={tools}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
      {showsBody(collapsed, hasBody) && (
        <div className="sb-page-widget-body">{children}</div>
      )}
    </div>
  );
}
