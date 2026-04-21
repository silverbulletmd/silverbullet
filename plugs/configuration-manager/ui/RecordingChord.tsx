import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useCfg } from "./CfgContext.tsx";
import { keyEventToNotation, tokenHasRealModifier } from "./keys.ts";
import type { Conflicts } from "./keys.ts";
import { RecordingPreview } from "./chord_display.tsx";

type Props = {
  onCommit: (tokens: string[]) => Conflicts | null;
  onCancel: () => void;
  conflictCheck: (tokens: string[]) => Conflicts;
};

// Self-contained recording component. Mount to start recording; unmount to
// end. Installs a capture-phase keydown listener while mounted and calls
// stopImmediatePropagation so the sibling Escape-to-close handler is silenced
// during recording.
export function RecordingChord({ onCommit, onCancel, conflictCheck }: Props) {
  const { cfg } = useCfg();
  const [tokens, setTokens] = useState<string[]>([]);
  const [invalidFirstKey, setInvalidFirstKey] = useState<string | null>(null);
  const conflict = useMemo(() => conflictCheck(tokens), [tokens, conflictCheck]);

  // Callbacks change identity on parent re-render; stash in refs so the
  // effect can bind once and always call the latest.
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (e.key === "Escape") {
        onCancelRef.current();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        setTokens((t) => (t.length > 0 ? t.slice(0, -1) : t));
        setInvalidFirstKey(null);
        return;
      }
      if (e.key === "Enter") {
        // Read latest tokens via functional setter, then fire-and-forget.
        setTokens((t) => {
          if (t.length > 0) onCommitRef.current(t);
          return t;
        });
        return;
      }
      const notation = keyEventToNotation(e, cfg.isMac);
      if (!notation) return;
      setTokens((t) => {
        if (t.length === 0 && !tokenHasRealModifier(notation)) {
          setInvalidFirstKey(notation);
          return t;
        }
        setInvalidFirstKey(null);
        return [...t, notation];
      });
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [cfg.isMac]);

  return (
    <RecordingPreview
      tokens={tokens}
      conflict={conflict}
      invalidFirstKey={invalidFirstKey}
    />
  );
}
