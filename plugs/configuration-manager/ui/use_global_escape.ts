import { useEffect } from "preact/hooks";

// Bubble-phase listener. When a recording handler is mounted elsewhere using
// capture + stopImmediatePropagation, this one is silenced during recording.
export function useGlobalEscape(callback: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") callback();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [callback]);
}
