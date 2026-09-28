import { Button, Input } from "@silverbulletmd/silverbullet/ui";
import type { CaptureActionData } from "./types.ts";

export type CaptureActionOption = {
  id: string;
  name: string;
  description?: string;
};

export type CaptureViewProps = {
  draft: CaptureActionData;
  pendingCount: number;
  actions: CaptureActionOption[];
  loadingActions: boolean;
  busy?: boolean;
  error?: string;
  onChange: (field: "title" | "text" | "url", value: string) => void;
  onRun: (id: string) => void;
  onDiscard: () => void;
  onClose: () => void;
  onNext: () => void;
};

export function CaptureView(props: CaptureViewProps) {
  const {
    draft,
    pendingCount,
    actions,
    loadingActions,
    busy,
    error,
    onChange,
    onRun,
    onDiscard,
    onClose,
    onNext,
  } = props;
  return (
    <div class="sb-modal-backdrop sb-capture-backdrop">
      <section
        class="sb-capture"
        role="dialog"
        aria-label="Capture share"
        aria-modal="true"
      >
        <header class="sb-capture-header">
          <h2>Capture share</h2>
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
        </header>
        <p>
          {pendingCount} pending capture{pendingCount === 1 ? "" : "s"}
        </p>
        <label>
          Title
          <Input
            value={draft.title}
            onInput={(event) => onChange("title", event.currentTarget.value)}
          />
        </label>
        <label>
          Text
          <textarea
            value={draft.text}
            onInput={(event) => onChange("text", event.currentTarget.value)}
          />
        </label>
        <label>
          URL
          <Input
            value={draft.url}
            onInput={(event) => onChange("url", event.currentTarget.value)}
          />
        </label>
        {draft.files.length > 0 && (
          <ul class="sb-capture-files">
            {draft.files.map((file) => (
              <li key={file.handle}>
                {file.name} ({file.type || "file"}, {file.size} bytes)
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" class="sb-capture-error">
            {error}
          </p>
        )}
        <div class="sb-capture-actions">
          {actions.map((action) => (
            <Button
              key={action.id}
              onClick={() => onRun(action.id)}
              disabled={busy}
            >
              {action.name}
              {action.description ? ` — ${action.description}` : ""}
            </Button>
          ))}
          {loadingActions && <p>Loading capture actions…</p>}
          {!loadingActions && actions.length === 0 && (
            <p>No capture actions available</p>
          )}
        </div>
        <footer class="sb-capture-footer">
          {pendingCount > 1 && (
            <Button onClick={onNext} disabled={busy}>
              Next capture
            </Button>
          )}
          <Button variant="danger" onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
        </footer>
      </section>
    </div>
  );
}
