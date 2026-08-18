import { useLayoutEffect } from "preact/hooks";
import type { Client } from "../../client.ts";
import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { hide } from "../navigator.ts";
import { NavErrorBoundary } from "./components/nav_error_boundary.tsx";
import { NavRoot } from "./components/nav_root.tsx";
import type { NavSlotState } from "./slots.ts";

/** A docked navigator panel, or nothing when the slot is empty. */
export function NavigatorDock({
  slot,
  state,
  client,
}: {
  slot: "lhs" | "rhs";
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

  // The way out when the panel itself didn't get the keystroke, so the fixed
  // backdrop can never trap the user. A layout effect, not a plain one: that
  // is flushed after paint, leaving the modal on screen for a frame with no
  // Escape handler attached.
  useLayoutEffect(() => {
    if (token === undefined) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
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
          (state.paintReady ? "" : " sb-modal-paint-pending")
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
