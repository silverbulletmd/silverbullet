import { useRef } from "preact/hooks";

const MIN_DOCK_SIZE = 160;
const MAX_DOCK_SIZE = 600;

export type ResizeHandleProps = {
  slot: "lhs" | "rhs" | "bhs";
  onResize: (sizePx: number, commit: boolean) => void;
};

export function resizedDockSize(
  slot: ResizeHandleProps["slot"],
  startSize: number,
  startPointer: number,
  pointer: number,
): number {
  const sign = slot === "lhs" ? 1 : -1;
  return Math.min(
    MAX_DOCK_SIZE,
    Math.max(MIN_DOCK_SIZE, startSize + sign * (pointer - startPointer)),
  );
}

/**
 * A window dock's draggable edge. Rendered as a child of the dock it resizes.
 */
export function ResizeHandle({ slot, onResize }: ResizeHandleProps) {
  const dragging = useRef<{ startPointer: number; startSize: number } | null>(
    null,
  );
  const raf = useRef<number | undefined>(undefined);
  const latestWidth = useRef<number | undefined>(undefined);

  function onPointerMove(e: PointerEvent) {
    const start = dragging.current;
    if (!start) return;
    const size = resizedDockSize(
      slot,
      start.startSize,
      start.startPointer,
      slot === "bhs" ? e.clientY : e.clientX,
    );
    latestWidth.current = size;
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
    const dock = (e.currentTarget as HTMLElement).parentElement;
    const rect = dock?.getBoundingClientRect();
    dragging.current = {
      startPointer: slot === "bhs" ? e.clientY : e.clientX,
      startSize: (slot === "bhs" ? rect?.height : rect?.width) ?? MIN_DOCK_SIZE,
    };
    // Capture keeps delivering events after the drag leaves the narrow handle.
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
