import { useLayoutEffect } from "preact/hooks";
import type { Client } from "../../client.ts";
import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { hide } from "../navigator.ts";
import { currentPreview } from "../views/revision_preview.ts";
import { NavErrorBoundary } from "./components/nav_error_boundary.tsx";
import { NavRoot } from "./components/nav_root.tsx";
import { NAV_PAINT_PENDING_CLASS, type NavSlotState } from "./slots.ts";

/** A docked navigator panel, or nothing when the slot is empty. */
export function NavigatorDock({
  slot,
  state,
  client,
}: {
  slot: "lhs" | "rhs" | "bhs";
  state?: NavSlotState;
  client: Client;
}) {
  if (!state) return null;
  return (
    <NavErrorBoundary slot={slot}>
      <NavRoot
        slot={slot}
        client={client}
        activation={state.activation}
        mode={state.mode}
      />
    </NavErrorBoundary>
  );
}

/** The modal navigator panel: a centered box over a full-screen backdrop. */
export function NavigatorModal({
  state,
  client,
}: {
  state?: NavSlotState;
  client: Client;
}) {
  const token = state?.activation.token;

  // Handle Escape outside the panel too. Register before paint so the
  // backdrop is never visible without a way to dismiss it.
  useLayoutEffect(() => {
    if (token === undefined) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (currentPreview()) return;
      // A keystroke the panel itself received is the panel's to answer.
      if ((ev.target as HTMLElement | null)?.closest?.(".sb-nav-root")) return;
      ev.preventDefault();
      void hide("modal", token).then(() => editor.focus());
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [token]);

  if (!state) return null;
  const inset = typeof state.mode === "number" ? `${state.mode}px` : state.mode;
  return (
    <div
      className="sb-modal-backdrop"
      onClick={(ev) => {
        if (ev.target !== ev.currentTarget) return;
        void hide("modal").then(() => editor.focus());
      }}
    >
      <div
        className={
          "sb-modal sb-modal-centered" +
          (state.paintReady ? "" : ` ${NAV_PAINT_PENDING_CLASS}`)
        }
        style={{
          top: inset,
          maxHeight:
            typeof state.mode === "number"
              ? `calc(100% - ${state.mode * 2}px)`
              : undefined,
        }}
      >
        <NavErrorBoundary slot="modal">
          <NavRoot slot="modal" client={client} activation={state.activation} />
        </NavErrorBoundary>
      </div>
    </div>
  );
}
