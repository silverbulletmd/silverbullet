import { useRef } from "preact/hooks";

const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 600;

export type ResizeHandleProps = {
  slot: "lhs" | "rhs";
  onResize: (widthPx: number, commit: boolean) => void;
};

/** A sidebar's draggable edge, for a caller whose dock grows/shrinks by width. */
export function ResizeHandle({ slot, onResize }: ResizeHandleProps) {
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const latestWidth = useRef<number | undefined>(undefined);

  function onPointerMove(e: PointerEvent) {
    const start = dragging.current;
    if (!start) return;
    // lhs grows to the right (toward the editor); rhs grows to the left.
    const sign = slot === "lhs" ? 1 : -1;
    const width = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(
        MIN_SIDEBAR_WIDTH,
        start.startWidth + sign * (e.clientX - start.startX),
      ),
    );
    latestWidth.current = width;
    if (raf.current === undefined) {
      raf.current = requestAnimationFrame(() => {
        raf.current = undefined;
        if (latestWidth.current !== undefined) {
          onResize(latestWidth.current, false);
        }
      });
    }
  }

  function endDrag(e: PointerEvent, commit: boolean) {
    const target = e.currentTarget as HTMLElement;
    // A pointercancel has already implicitly released capture; guard so
    // that doesn't throw ("no capture to release") in that path.
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    if (raf.current !== undefined) {
      cancelAnimationFrame(raf.current);
      raf.current = undefined;
    }
    if (commit && latestWidth.current !== undefined) {
      onResize(latestWidth.current, true);
    }
    dragging.current = null;
    latestWidth.current = undefined;
  }

  function onPointerUp(e: PointerEvent) {
    endDrag(e, true);
  }

  function onPointerCancel(e: PointerEvent) {
    // e.g. the OS hands the gesture to something else mid-drag -- drop the
    // in-progress resize without committing an uncommitted width.
    endDrag(e, false);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // primary button (or touch) only
    // The document is sized to exactly match the dock's current width, so
    // its own width doubles as the drag's starting width.
    dragging.current = {
      startX: e.clientX,
      startWidth: document.documentElement.clientWidth,
    };
    // Pointer capture (rather than a plain global mousemove listener) keeps
    // delivering move/up events to this element even once the cursor leaves
    // its own bounds -- which it does almost immediately, since the handle
    // sits flush with the dock's edge and growing the dock means dragging
    // away from where the pointer went down.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  return (
    <div
      class={`sb-resizer sb-resizer-${slot}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}
