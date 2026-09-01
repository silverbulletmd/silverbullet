import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { editor, space } from "@silverbulletmd/silverbullet/syscalls";
import { Button } from "../../../../plug-api/ui/button.tsx";
import { SegmentedControl } from "../../../../plug-api/ui/segmented_control.tsx";
import { focusPanel } from "../../navigator.ts";
import {
  closePreview,
  type RevisionPreview,
  restoreInto,
  useRevisionPreview,
} from "../../views/revision_preview.ts";

const MODES = [{ label: "Diff" }, { label: "Content" }];

function close(dock: string) {
  closePreview();
  focusPanel(dock);
}

function PreviewBody({ preview }: { preview: RevisionPreview }) {
  const { path, rev, diff, canRestore, dock } = preview;
  const canShowContent = rev !== undefined;
  const [showContent, setShowContent] = useState(diff === undefined);
  const [content, setContent] = useState<string | undefined>();
  const [contentFailed, setContentFailed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [fromParent, setFromParent] = useState(false);
  // `restore()` can trigger the very fetch that discovers `fromParent`, and
  // then needs the answer before this render's `setFromParent` has committed
  // -- the state alone would still read stale mid-call.
  const fromParentRef = useRef(fromParent);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (preview.focus) closeRef.current?.focus();
  }, []);

  // Shared by the Content pane and Restore, so viewing one then doing the
  // other costs a single fetch. A failure is never cached, so a retry is real.
  async function fetchContent(): Promise<string> {
    if (content !== undefined) return content;
    let text: string;
    try {
      text = await space.getRevision(path, rev!);
    } catch (e) {
      if ((e as { status?: number } | undefined)?.status !== 404) throw e;
      text = await space.getRevision(path, rev!, true);
      fromParentRef.current = true;
      setFromParent(true);
    }
    setContent(text);
    return text;
  }

  useEffect(() => {
    if (!showContent || content !== undefined) return;
    let live = true;
    fetchContent().catch(() => {
      if (live) setContentFailed(true);
    });
    return () => {
      live = false;
    };
  }, [showContent]);

  async function restore() {
    setRestoring(true);
    try {
      const text = await fetchContent();
      await restoreInto(path, text);
      await editor.flashNotification(
        fromParentRef.current
          ? `Restored ${path} as it was before ${rev!.slice(0, 8)}`
          : `Restored revision ${rev!.slice(0, 8)}`,
      );
      close(dock);
    } catch (e: any) {
      setRestoring(false);
      await editor.flashNotification(e.message, "error");
    }
  }

  return (
    <>
      <div class="sb-revision-preview-header">
        <span class="sb-revision-preview-title">
          {showContent && fromParent
            ? `before this commit — ${preview.header}`
            : preview.header}
        </span>
        {diff !== undefined && canShowContent && (
          <SegmentedControl
            items={MODES}
            activeIndex={showContent ? 1 : 0}
            onPick={(i) => setShowContent(i === 1)}
            takeFocus
            ariaLabel="Preview mode"
          />
        )}
      </div>
      <div class="sb-revision-preview-message">{preview.message}</div>
      <pre class="sb-revision-preview-body">
        {showContent ? (
          contentFailed ? (
            "Could not load full content."
          ) : (
            (content ?? "Loading…")
          )
        ) : (
          <DiffBody diff={diff!} />
        )}
      </pre>
      <div class="sb-revision-preview-footer">
        <Button buttonRef={closeRef} onClick={() => close(dock)}>
          Close
        </Button>
        {canRestore && (
          <Button variant="primary" disabled={restoring} onClick={restore}>
            {fromParent ? "Restore version before this" : "Restore"}
          </Button>
        )}
      </div>
    </>
  );
}

function DiffBody({ diff }: { diff: RevisionPreview["diff"] }) {
  return (
    <>
      {diff!.map((line, i) => (
        <span key={i} class={line.cssClass}>
          {line.text}
          {i < diff!.length - 1 ? "\n" : ""}
        </span>
      ))}
    </>
  );
}

/** The revision preview overlay, rendered in the client's own Preact tree. */
export function RevisionPreviewModal() {
  const preview = useRevisionPreview();
  const token = preview?.token;

  useLayoutEffect(() => {
    if (!preview) return;
    const dock = preview.dock;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      close(dock);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [token]);

  if (!preview) return null;
  return (
    <div
      class="sb-modal-backdrop"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) close(preview.dock);
      }}
    >
      {/* Same inset the preview used as a plug modal, and the definite
          height the scrolling body needs. */}
      <div class="sb-modal sb-revision-preview" style={{ inset: "100px" }}>
        {/* Keyed so a new preview remounts rather than inheriting the previous
            one's fetch state -- what the old iframe needed a render-id guard for. */}
        <PreviewBody key={preview.token} preview={preview} />
      </div>
    </div>
  );
}
