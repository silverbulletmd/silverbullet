import type { ComponentChildren, RefObject } from "preact";
import { Fragment } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { prettifyShortcut } from "../../../plug-api/lib/shortcut.ts";
import {
  type Conflicts,
  keyEventToNotation,
  tokenHasRealModifier,
  tokenize,
} from "./keys.ts";

export function ChordTokens({ tokens }: { tokens: string[] }) {
  return (
    <>
      {tokens.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sb-wb-cfg-chord-sep">then</span>}
          <kbd className="sb-wb-cfg-key">{prettifyShortcut(t)}</kbd>
        </Fragment>
      ))}
    </>
  );
}

export function ChordDisplay({ binding }: { binding: string }) {
  const tokens = tokenize(binding);
  if (tokens.length === 0) {
    return <span className="sb-wb-muted">none</span>;
  }
  return <ChordTokens tokens={tokens} />;
}

export type ChordNotice = {
  severity: "error" | "warn";
  message: ComponentChildren;
};

/**
 * What to tell about a chord being recorded: blocking conflicts first, then
 * the soft "start of another binding" notice, then a first key that needs a
 * modifier.
 */
export function chordNotice(
  c: Conflicts,
  invalidFirstKey: string | null,
): ChordNotice | null {
  if (c.otherIsPrefix.length > 0) {
    const e = c.otherIsPrefix[0];
    return {
      severity: "error",
      message: (
        <>
          Unreachable: <strong>{e.name}</strong> (<code>{e.binding}</code>)
          fires before you can press more keys.
        </>
      ),
    };
  }
  if (c.duplicate.length > 0) {
    return {
      severity: "error",
      message: (
        <>
          Already bound to <strong>{c.duplicate[0].name}</strong>. Pick another
          key, or Esc to cancel.
        </>
      ),
    };
  }
  if (c.prefixOfOther.length > 0) {
    const e = c.prefixOfOther[0];
    const more =
      c.prefixOfOther.length > 1
        ? ` (+${c.prefixOfOther.length - 1} more)`
        : "";
    return {
      severity: "warn",
      message: (
        <>
          This is the start of <strong>{e.name}</strong> (
          <code>{e.binding}</code>){more}. Press another key to continue.
        </>
      ),
    };
  }
  if (invalidFirstKey) {
    return {
      severity: "warn",
      message: (
        <>
          Key bindings start with a modifier (Ctrl, Cmd, Alt or Mod):{" "}
          <code>{invalidFirstKey}</code> ignored.
        </>
      ),
    };
  }
  return null;
}

export function RecordingPreview({ tokens }: { tokens: string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Holds focus while recording, so it stays inside the Workbench
  useLayoutEffect(() => ref.current?.focus(), []);
  return (
    <span className="sb-wb-cfg-recording" ref={ref} tabIndex={-1}>
      {tokens.length === 0 ? (
        <em>Press keys…</em>
      ) : (
        <ChordTokens tokens={tokens} />
      )}
      <span className="sb-wb-cfg-caret">▎</span>
    </span>
  );
}

export type RecorderHandlers = {
  key: (notation: string, hasModifier: boolean) => void;
  undo: () => void;
  commit: () => void;
  cancel: () => void;
  /** Pressed somewhere else: recording ends and focus stays where it went */
  leave: () => void;
};

/**
 * While `active`, every keydown is a chord key: taken at window capture, ahead
 * of the client's own shortcut handling and CodeMirror, and never passed on,
 * so recording Cmd-k records it rather than opening the page picker.
 */
export function useChordRecorder(
  active: boolean,
  isMac: boolean,
  area: RefObject<HTMLElement>,
  handlers: RecorderHandlers,
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  // Layout effect: listening before "Press keys…" paints, so a key pressed
  // as soon as it shows is recorded, not sent on to the page
  useLayoutEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const h = latest.current;
      if (e.key === "Escape") return h.cancel();
      if (e.key === "Backspace" || e.key === "Delete") return h.undo();
      if (e.key === "Enter") return h.commit();
      const notation = keyEventToNotation(e, isMac);
      if (notation) h.key(notation, tokenHasRealModifier(notation));
    };
    // Pressing anywhere else (another tab, the editor) ends recording, or it
    // would go on swallowing keys with nothing on screen saying so
    const onPointerDown = (e: PointerEvent) => {
      if (!area.current?.contains(e.target as Node)) latest.current.leave();
    };
    globalThis.addEventListener("keydown", onKeyDown, { capture: true });
    globalThis.addEventListener("pointerdown", onPointerDown, {
      capture: true,
    });
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown, { capture: true });
      globalThis.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
    };
  }, [active, isMac]);
}
