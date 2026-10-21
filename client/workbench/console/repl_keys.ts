import type { KeyBinding } from "@codemirror/view";
import type { Command } from "../../types/command.ts";

const PRIMARY = new Set(["mod", "cmd", "meta", "m", "ctrl", "control", "c"]);
const COMMAND_MODIFIERS = new Set([...PRIMARY, "alt", "a"]);
const SHIFT = new Set(["shift", "s"]);
// The REPL edits text; these stay with it whatever modifier comes along
const EDITING_KEYS = new Set([
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  "home",
  "end",
  "pageup",
  "pagedown",
  "backspace",
  "delete",
  "enter",
  "tab",
  "escape",
  "space",
]);
const CLIPBOARD_UNDO_KEYS = new Set(["a", "c", "v", "x", "z", "y"]);

// Whether a command key binding should reach the app from inside the REPL
export function forwardsFromRepl(key: string): boolean {
  const first = key.split(/ (?!$)/)[0];
  const parts = first.split(/-(?!$)/);
  const name = parts.pop()!.toLowerCase();
  const mods = parts.map((p) => p.toLowerCase());
  if (!mods.some((m) => COMMAND_MODIFIERS.has(m))) return false;
  if (EDITING_KEYS.has(name)) return false;
  const onlyPrimary = mods.every((m) => SHIFT.has(m) || PRIMARY.has(m));
  return !(onlyPrimary && CLIPBOARD_UNDO_KEYS.has(name));
}

// Page-editor commands (`requireEditor` page/notpage/named, or cursor contexts) never bind here
export function replCommandBindings(
  commands: Iterable<Command>,
  opts: { isMac: boolean; readOnly: boolean; run: (cmd: Command) => void },
): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  for (const cmd of commands) {
    if (cmd.requireEditor !== undefined && cmd.requireEditor !== "any") {
      continue;
    }
    if (cmd.contexts) continue;
    if (opts.readOnly && cmd.requireMode === "rw") continue;
    const keys = (opts.isMac && cmd.mac) || cmd.key;
    if (!keys) continue;
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (!forwardsFromRepl(key)) continue;
      bindings.push({
        key,
        run: () => {
          opts.run(cmd);
          return true;
        },
      });
    }
  }
  return bindings;
}
