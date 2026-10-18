import { useEffect } from "preact/hooks";
import { dismiss } from "./host.ts";

export function useEscape() {
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        await dismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
