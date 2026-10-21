import type { LuaRuntimeError } from "../../space_lua/runtime.ts";
import {
  type FrameTarget,
  luaErrorFrames,
  type SourceFrame,
  type SourceLookup,
  splitHint,
} from "./source_frames.ts";

/** Opens what a frame link points at; each tab decides what that means. */
export type OpenTarget = (target: FrameTarget) => void;

// Frames are resolved against the sources as they were when the error first rendered
const framesCache = new WeakMap<LuaRuntimeError, SourceFrame[]>();

export function errorFrames(
  err: LuaRuntimeError,
  sourceFor: SourceLookup,
): SourceFrame[] {
  let frames = framesCache.get(err);
  if (!frames) {
    frames = luaErrorFrames(err, sourceFor);
    framesCache.set(err, frames);
  }
  return frames;
}

/** A Lua error's message, hint, marked source line and stack. */
export function LuaErrorDetails({
  err,
  frames,
  onOpen,
}: {
  err: LuaRuntimeError;
  frames: SourceFrame[];
  onOpen: OpenTarget;
}) {
  const { message, hint } = splitHint(err.message);
  const excerpt = frames[0]?.excerpt;
  return (
    <>
      <div className="sb-wb-message">{message}</div>
      {hint ? <div className="sb-wb-hint">Hint: {hint}</div> : null}
      {excerpt ? (
        <pre className="sb-wb-excerpt">
          {`${excerpt.lineText}\n${" ".repeat(excerpt.column)}${"^".repeat(excerpt.length)}`}
        </pre>
      ) : null}
      {frames.length > 0 ? (
        <details className="sb-wb-stack">
          <summary>Stack ({frames.length} frames)</summary>
          <ul>
            {frames.map((f, i) => (
              <li key={i}>
                <FrameLabel frame={f} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

export function FrameLabel({
  frame,
  onOpen,
}: {
  frame: SourceFrame;
  onOpen: OpenTarget;
}) {
  const { target } = frame;
  if (!target) return <span>{frame.label}</span>;
  return (
    <button
      type="button"
      className="sb-wb-link"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(target);
      }}
    >
      {frame.label}
    </button>
  );
}
