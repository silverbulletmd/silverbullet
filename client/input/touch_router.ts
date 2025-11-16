// client/input/touch_router.ts
// A single non-passive touchstart listener that dispatches actions based on finger-count.

import type { TouchMapEntry } from "./touch_registry.ts";
import { buildTouchMap } from "./touch_registry.ts";
import type { Client } from "../client.ts";

export function setupTouchRouter(client: Client) {
  if ((navigator as any).maxTouchPoints <= 0) {
    return { dispose: () => {}, refresh: () => {} }; // noop
  }

  function readConfigBindings(): {
    fingers: number;
    command: string;
    preventDefault?: boolean;
  }[] {
    return client.config.get("ui.touch.bindings", []);
  }

  function compile(): Map<number, TouchMapEntry> {
    const cfg = readConfigBindings();
    try {
      map = buildTouchMap(cfg);
    } catch {
      client.flashNotification(
        "unexpected errur in touch_router:compile()",
        "error",
      );
    }
    return map;
  }

  let map: Map<number, TouchMapEntry>;

  client.clientSystem?.commandHook?.on?.({
    commandsUpdated: () => {
      map = compile();
    },
  });
  // Optional: one-shot delayed refresh for slow boots
  // setTimeout(() => { map = compile(); }, 1500);

  const onTouchStart = (ev: TouchEvent) => {
    const n = ev.touches?.length ?? 0;
    if (!n) return;
    let binding = map.get(n);
    if (!binding) {
      try {
        map = compile();
      } catch { /* ignore */ }
      binding = map.get(n);
      if (!binding) return;
    }

    const name = binding.command;

    // Disabled if empty or "none"
    if (!name || name === "none") return;

    if (binding.preventDefault) {
      ev.preventDefault();
      ev.stopPropagation();
    }

    try {
      client.runCommandByName(name);
    } catch {
      client.flashNotification(
        "unexpected errur in touch_router:onTouchStart()",
        "error",
      );
    }
  };

  globalThis.addEventListener("touchstart", onTouchStart, { passive: false });

  function refresh() {
    map = compile();
  }

  const dispose = () =>
    globalThis.removeEventListener("touchstart", onTouchStart);
  return { dispose, refresh };
}
