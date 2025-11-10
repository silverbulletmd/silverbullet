// client/input/touch_router.ts
// A single non-passive touchstart listener that dispatches actions based on finger-count.

import type { TouchMapEntry } from "./touch_registry.ts";
import { buildTouchMap } from "./touch_registry.ts";

type CommandLike = { name: string; touch?: { fingers: number; preventDefault?: boolean }[] };

type ClientLike = {
  config: { get<T>(path: string, def: T): T };
  startPageNavigate: (mode: "page" | "meta" | "document" | "all") => void;
  startCommandPalette: () => void;
  ui?: { viewState?: { commands?: CommandLike[] } };
};

export function setupTouchRouter(client: ClientLike) {
  function readConfigBindings(): { fingers: number; command: string; preventDefault?: boolean }[] {
    return client.config.get("ui.touch.bindings", [] as any[]);
  }

  function readCommands(): CommandLike[] {
    try {
      return client.ui?.viewState?.commands ?? [];
    } catch {
      return [];
    }
  }

  function compile(): Map<number, TouchMapEntry> {
    const cfg = readConfigBindings();
    const cmds = readCommands();
    return buildTouchMap(cmds, cfg);
  }

  let map: Map<number, TouchMapEntry>;
  try {
    map = compile();
  } catch {
    map = buildTouchMap([], readConfigBindings());
  }

  const onTouchStart = (ev: TouchEvent) => {
    const n = (ev.touches?.length ?? 0);
    if (!n) return;
    let binding = map.get(n);
    if (!binding) {
      try { map = compile(); } catch { /* ignore */ }
      binding = map.get(n);
      if (!binding) return;
    }

    if (binding.preventDefault) {
      ev.preventDefault();
      ev.stopPropagation();
    }

    const name = binding.command;

    // Disabled if empty or "none"
    if (!name || name === "none") return;

    if (name === "Navigate: Page Picker") {
      client.startPageNavigate("page");
    } else if (name === "Command: Open Palette") {
      client.startCommandPalette();
    } else {
      // ✅ Run any command by name (no palette fallback unless you want one)
      try {
        // fire-and-forget is fine; or await if you prefer
        void client.runCommandByName(name);
      } catch (_e) {
        // Optional gentle fallback if a typo or timing issue:
        // client.startCommandPalette();
      }
    }
  };

  globalThis.addEventListener("touchstart", onTouchStart, { passive: false });

  function refresh() {
    map = compile();
  }

  const dispose = () => globalThis.removeEventListener("touchstart", onTouchStart);
  return { dispose, refresh };
}
