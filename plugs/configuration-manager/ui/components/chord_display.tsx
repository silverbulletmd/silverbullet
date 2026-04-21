import { Fragment } from "preact";
import type { ComponentChildren } from "preact";
import type { Conflicts } from "../keys.ts";
import { prettifyShortcut } from "../../../../plug-api/lib/shortcut.ts";

export function cls(map: Record<string, boolean>): string {
  return Object.entries(map).filter(([, v]) => v).map(([k]) => k).join(" ");
}

export function ChordTokens({ tokens }: { tokens: string[] }) {
  return (
    <>
      {tokens.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && <span class="cfg-chord-sep">then</span>}
          <kbd class="cfg-chord-key">{prettifyShortcut(t)}</kbd>
        </Fragment>
      ))}
    </>
  );
}

export function ChordChips({ binding }: { binding: string }) {
  const tokens = binding.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return <span class="cfg-shortcut-empty">none</span>;
  }
  return <ChordTokens tokens={tokens} />;
}

// Pick the most informative conflict class. Blocking classes take precedence
// over the soft "this is a prefix of another" notice.
function describeConflict(
  c: Conflicts,
): {
  severity: "error" | "warn";
  message: ComponentChildren;
  tooltip: string;
} | null {
  if (c.otherIsPrefix.length > 0) {
    const e = c.otherIsPrefix[0];
    return {
      severity: "error",
      message: (
        <>
          ⚠ unreachable — <strong>{e.name}</strong> (<code>{e.binding}</code>)
          {" "}fires before you can press more keys
        </>
      ),
      tooltip: c.otherIsPrefix.map((x) => `${x.name}: ${x.binding}`).join("\n"),
    };
  }
  if (c.duplicate.length > 0) {
    const e = c.duplicate[0];
    return {
      severity: "error",
      message: (
        <>
          ⚠ already bound to <strong>{e.name}</strong>
        </>
      ),
      tooltip: c.duplicate.map((x) => `${x.name}: ${x.binding}`).join("\n"),
    };
  }
  if (c.prefixOfOther.length > 0) {
    const e = c.prefixOfOther[0];
    const more = c.prefixOfOther.length > 1
      ? ` (+${c.prefixOfOther.length - 1} more)`
      : "";
    return {
      severity: "warn",
      message: (
        <>
          This is the start of <strong>{e.name}</strong>{" "}
          (<code>{e.binding}</code>){more} — press another key to continue
        </>
      ),
      tooltip: c.prefixOfOther.map((x) => `${x.name}: ${x.binding}`).join("\n"),
    };
  }
  return null;
}

export function RecordingPreview(
  { tokens, conflict, invalidFirstKey }: {
    tokens: string[];
    conflict: Conflicts;
    invalidFirstKey: string | null;
  },
) {
  let info = describeConflict(conflict);
  if (invalidFirstKey && !info) {
    info = {
      severity: "warn",
      message: (
        <>
          Key bindings must start with a modifier (<kbd>Ctrl</kbd>,{" "}
          <kbd>Cmd</kbd>, <kbd>Alt</kbd>, or <kbd>Mod</kbd>) —{" "}
          <code>{invalidFirstKey}</code> ignored
        </>
      ),
      tooltip: "",
    };
  }
  return (
    <span
      class={cls({
        "cfg-shortcut-recording": true,
        "cfg-shortcut-recording-conflict": info?.severity === "error",
        "cfg-shortcut-recording-warn": info?.severity === "warn",
      })}
    >
      {tokens.length === 0
        ? <em>Press keys…</em>
        : <ChordTokens tokens={tokens} />}
      <span class="cfg-recording-caret">▎</span>
      {info
        ? (
          <span
            class={cls({
              "cfg-recording-error": info.severity === "error",
              "cfg-recording-warn": info.severity === "warn",
            })}
            title={info.tooltip}
          >
            {info.message}
          </span>
        )
        : (
          <span class="cfg-recording-hint">
            Enter to commit · Esc to cancel · ⌫ to undo
          </span>
        )}
    </span>
  );
}
