import type {
  ModelDownload,
  SearchModelState,
  StoredModel,
} from "../types/search_admin.ts";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Field } from "./field.tsx";
import { Progress } from "./progress.tsx";
import { Select } from "./select.tsx";
import {
  downloadProgress,
  formatAboutBytes,
  formatBytes,
} from "./search_admin_format.ts";

export type SearchModelPickerProps = {
  model: SearchModelState;
  /** Disables the controls while the host applies a change. */
  busy: boolean;
  /** The model chosen (null: none, also "Cancel download"). */
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  /** Opens the model's page; by default the link opens a new tab. */
  onOpenModelPage?: (url: string) => void;
};

/**
 * Chooses the search model: the offered models, the selected one's card and
 * download, and the models stored on disk. Never fetches or confirms; the
 * host does.
 */
export function SearchModelPicker({
  model: state,
  busy,
  onSelect,
  onRemove,
  onOpenModelPage,
}: SearchModelPickerProps) {
  const model = state.catalog.find((m) => m.id === state.model) ?? null;
  return (
    <div class="sb-search-model">
      <Field label="Search model">
        <Select
          value={state.model ?? ""}
          disabled={busy}
          onChange={(e) => onSelect(e.currentTarget.value || null)}
        >
          <option value="">None (full-text search only)</option>
          {state.catalog.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </Select>
      </Field>
      {model && (
        <div class="sb-search-model-card">
          <div class="sb-search-model-name">{model.displayName}</div>
          <div class="sb-search-model-languages">{model.languages}</div>
          <div class="sb-search-model-size">
            Download {formatBytes(model.downloadBytes)} · Memory about{" "}
            {formatAboutBytes(model.residentBytes)}
          </div>
          <div class="sb-search-model-license">
            License: {model.license} ·{" "}
            <a
              href={model.homepage}
              target="_blank"
              rel="noopener noreferrer"
              onClick={
                onOpenModelPage &&
                ((e) => {
                  e.preventDefault();
                  onOpenModelPage(model.homepage);
                })
              }
            >
              Model page ↗
            </a>
          </div>
          {model.notice && (
            <div class="sb-search-model-notice">{model.notice}</div>
          )}
          {state.download && (
            <DownloadState
              download={state.download}
              busy={busy}
              onCancel={() => onSelect(null)}
            />
          )}
        </div>
      )}
      {state.stored.length > 0 && (
        <div class="sb-search-model-stored">
          <div class="sb-search-model-stored-title">Stored models</div>
          <ul>
            {state.stored.map((s) => (
              <StoredRow
                key={s.id}
                stored={s}
                busy={busy}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DownloadState({
  download,
  busy,
  onCancel,
}: {
  download: ModelDownload;
  busy: boolean;
  onCancel: () => void;
}) {
  switch (download.state) {
    case "downloading":
      return (
        <div class="sb-search-model-download">
          <Progress value={downloadProgress(download)} />
          <span>
            {formatBytes(download.done)} of {formatBytes(download.total)}
          </span>
          <Button disabled={busy} onClick={onCancel}>
            Cancel download
          </Button>
        </div>
      );
    case "ready":
      return <div class="sb-search-model-download">Ready</div>;
    case "failed":
      return (
        <div class="sb-search-model-download sb-search-model-failed">
          Download failed: {download.message}, retrying
        </div>
      );
    case "missing":
      return <div class="sb-search-model-download">Not downloaded yet</div>;
  }
}

function StoredRow({
  stored,
  busy,
  onRemove,
}: {
  stored: StoredModel;
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <li class="sb-search-model-stored-row">
      <span class="sb-search-model-stored-name">{stored.displayName}</span>
      <span class="sb-search-model-stored-size">
        {formatBytes(stored.bytes)}
      </span>
      {!stored.complete && <Badge>partial download</Badge>}
      {stored.active ? (
        <Badge>in use</Badge>
      ) : (
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => onRemove(stored.id)}
        >
          Remove
        </Button>
      )}
    </li>
  );
}
