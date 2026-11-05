import { useRef } from "preact/hooks";

export type ResizeHandleProps = {
  /** "x" drags a width, "y" a height */
  axis?: "x" | "y";
  /** -1 when the panel grows as the pointer moves left (or up) */
  direction?: 1 | -1;
  /** The size a drag starts from */
  size: (handle: HTMLElement) => number;
  /** Called at most once a frame while dragging, then with `commit` on release */
  onResize: (sizePx: number, commit: boolean) => void;
  onReset?: () => void;
  className?: string;
  label?: string;
};

export function draggedSize(
  startSize: number,
  startPointer: number,
  pointer: number,
  direction: 1 | -1 = 1,
): number {
  return startSize + direction * (pointer - startPointer);
}

/** A panel's draggable edge; double-click resets it when `onReset` is given. */
export function ResizeHandle({
  axis = "x",
  direction = 1,
  size,
  onResize,
  onReset,
  className,
  label,
}: ResizeHandleProps) {
  const dragging = useRef<{ startPointer: number; startSize: number } | null>(
    null,
  );
  const raf = useRef<number | undefined>(undefined);
  const latestSize = useRef<number | undefined>(undefined);
  const pointerOf = (e: PointerEvent) => (axis === "y" ? e.clientY : e.clientX);

  function onPointerMove(e: PointerEvent) {
    const start = dragging.current;
    if (!start) return;
    latestSize.current = draggedSize(
      start.startSize,
      start.startPointer,
      pointerOf(e),
      direction,
    );
    if (raf.current === undefined) {
      raf.current = requestAnimationFrame(() => {
        raf.current = undefined;
        if (latestSize.current !== undefined) {
          onResize(latestSize.current, false);
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
    if (commit && latestSize.current !== undefined) {
      onResize(latestSize.current, true);
    }
    dragging.current = null;
    latestSize.current = undefined;
    document.body.classList.remove("sb-resizing", `sb-resizing-${axis}`);
  }

  function onPointerCancel(e: PointerEvent) {
    // e.g. the OS hands the gesture to something else mid-drag -- drop the
    // in-progress resize without committing an uncommitted width.
    endDrag(e, false);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // primary button (or touch) only
    const handle = e.currentTarget as HTMLElement;
    dragging.current = { startPointer: pointerOf(e), startSize: size(handle) };
    // Capture keeps delivering events after the drag leaves the narrow handle.
    handle.setPointerCapture(e.pointerId);
    // No text selection or cursor flicker while dragging over other panels
    document.body.classList.add("sb-resizing", `sb-resizing-${axis}`);
    e.preventDefault();
  }

  return (
    <div
      class={className ? `sb-resizer ${className}` : "sb-resizer"}
      role={label ? "separator" : undefined}
      aria-orientation={
        label ? (axis === "y" ? "horizontal" : "vertical") : undefined
      }
      aria-label={label}
      title={onReset ? "Drag to resize, double-click to reset" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={onPointerCancel}
      onDblClick={onReset}
    />
  );
}
