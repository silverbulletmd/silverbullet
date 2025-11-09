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

  async function runCommandByName(client: any, name: string): Promise<boolean> {
    try {
      // Prefer explicit APIs if present
      if (typeof client.runCommand === "function") {
        await client.runCommand(name);
        return true;
      }
      if (typeof client.clientSystem?.runCommand === "function") {
        await client.clientSystem.runCommand(name);
        return true;
      }
      if (typeof client.clientSystem?.invokeCommand === "function") {
        await client.clientSystem.invokeCommand(name);
        return true;
      }

      // Fall back to a direct command object with a run() (some builds expose it)
      const cmds: any[] = client.ui?.viewState?.commands ?? [];
      const cmd = cmds.find((c) => c?.name === name);
      if (cmd && typeof cmd.run === "function") {
        await cmd.run();
        return true;
      }
    } catch {
      // ignore and report false
    }
    return false;
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

    // Disable if empty or explicit "none"
    if (!name || name === "none") return;

    if (name === "Navigate: Page Picker") {
      client.startPageNavigate("page");
    } else if (name === "Command: Open Palette") {
      client.startCommandPalette();
    } else {
      // Try to run the command by name
      runCommandByName(client, name).then((ran) => {
        if (!ran) {
          // As a gentle fallback, show palette so user can confirm/trigger
          // (optional: pre-filter the palette if your build supports it)
          client.startCommandPalette();
        }
      });
    }
  };

  globalThis.addEventListener("touchstart", onTouchStart, { passive: false });

  function refresh() {
    map = compile();
  }

  const dispose = () => globalThis.removeEventListener("touchstart", onTouchStart);
  return { dispose, refresh };
}
