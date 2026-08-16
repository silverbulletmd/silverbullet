import type { Client } from "../client.ts";
import { isValidEditor } from "./command_filters.ts";
import { isMacLike } from "../../plug-api/lib/shortcut.ts";
import type { ChordDescriptor } from "../../plug-api/lib/shortcut.ts";

export type { ChordDescriptor };

/**
 * Parses one `key`/`mac` binding string (`"Ctrl-o"`, `"Cmd-Shift-p"`, CM's
 * portable `"Mod-o"`, ...) into a chord a keydown can be compared against.
 * `undefined` for anything this can't represent as one: a multi-step
 * sequence (space-separated, e.g. `"Mod-. t"` -- there is no single keydown
 * to prevent the default of; `boundChordManifest` below peels off just its
 * first token before calling this), an unrecognized modifier token, or a
 * chord with no Ctrl/Cmd/Mod (the only class `forwardGlobalShortcut` ever
 * forwards, so the only class worth representing here).
 */
export function parseChord(raw: string): ChordDescriptor | undefined {
  if (raw.includes(" ")) return undefined;
  const parts = raw.split("-");
  const key = parts.pop();
  if (!key) return undefined;
  let ctrlKey = false,
    metaKey = false,
    altKey = false,
    shiftKey = false;
  for (const part of parts) {
    switch (part) {
      case "Ctrl":
        ctrlKey = true;
        break;
      case "Cmd":
      case "Meta":
        metaKey = true;
        break;
      case "Alt":
        altKey = true;
        break;
      case "Shift":
        shiftKey = true;
        break;
      case "Mod":
        if (isMacLike) metaKey = true;
        else ctrlKey = true;
        break;
      default:
        return undefined;
    }
  }
  if (!ctrlKey && !metaKey) return undefined;
  return { key: key.toLowerCase(), ctrlKey, metaKey, altKey, shiftKey };
}

/**
 * Every Ctrl/Cmd(-ish) chord the host would actually run right now, as
 * plain-data descriptors a panel iframe can match a keydown against without
 * a round trip. Mirrors `createCommandKeyBindings`'s mac/key branching and
 * its vim/read-only/editor filters exactly — without them, a chord bound to
 * a currently-inert command would still win `preventDefault`. A multi-step
 * binding (e.g. `"Mod-. t"`) contributes only its first token: that keydown
 * is the one a browser default could steal.
 */
export function boundChordManifest(client: Client): ChordDescriptor[] {
  const vimMode = client.ui.viewState.uiOptions.vimMode;
  const readOnly = client.isReadOnlyMode();
  const currentEditor = client.contentManager.documentEditor?.name;

  const seen = new Set<string>();
  const chords: ChordDescriptor[] = [];
  const add = (raw: string | string[] | undefined) => {
    if (!raw) return;
    for (const one of Array.isArray(raw) ? raw : [raw]) {
      const spaceIdx = one.indexOf(" ");
      const parsed = parseChord(spaceIdx === -1 ? one : one.slice(0, spaceIdx));
      if (!parsed) continue;
      const dedupeKey = `${parsed.ctrlKey}${parsed.metaKey}${parsed.altKey}${parsed.shiftKey}${parsed.key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      chords.push(parsed);
    }
  };
  for (const def of client.clientSystem.commandHook
    .buildAllCommands()
    .values()) {
    if (def.disableInVim && vimMode) continue;
    if (readOnly && def.requireMode === "rw") continue;
    if (!isValidEditor(currentEditor, def.requireEditor)) continue;
    if (def.key && (!isMacLike || !def.mac)) add(def.key);
    if (def.mac && isMacLike) add(def.mac);
  }
  return chords;
}
