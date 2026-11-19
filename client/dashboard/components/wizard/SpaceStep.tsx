import {
  Alert,
  Button,
  type GalleryChoice,
  HAS_NOTES_WARNING,
  Input,
  type KitInfo,
  Select,
  StarterGallery,
} from "@silverbulletmd/silverbullet/ui";
import { FolderPicker } from "../../FolderPicker.tsx";
import { splitFieldErrors } from "../../field_errors.ts";
import { FieldErrors, InlineError } from "../../space_fields.tsx";
import { kitPreviewUrl } from "../../starter_kits.ts";
import type { Binding, FieldError, RevisionsMode } from "../../types.ts";
import {
  defaultFolder,
  parentDir,
  type SpaceValues,
  type StarterValues,
} from "../../wizard.ts";
import { BindingFields } from "../BindingFields.tsx";

export function SpaceStep({
  values,
  root,
  onNameInput,
  primaryUrl,
  onPrimaryUrlChange,
  onBindingChange,
  onFolderChange,
  onRevisionsChange,
  kits,
  kitsFailed,
  onStarterChange,
  errors,
  busy,
  onBack,
  onSubmit,
}: {
  values: SpaceValues;
  /** The server's absolute data root, used for the folder placeholder. */
  root: string;
  onNameInput: (name: string) => void;
  primaryUrl: string;
  onPrimaryUrlChange: (value: string) => void;
  onBindingChange: (binding: Binding) => void;
  onFolderChange: (folder: string) => void;
  onRevisionsChange: (revisions: RevisionsMode) => void;
  /** Undefined while the starter kits are still loading. */
  kits?: KitInfo[];
  kitsFailed: boolean;
  onStarterChange: (patch: Partial<StarterValues>) => void;
  errors: FieldError[];
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { byField, other } = splitFieldErrors(errors, [
    "name",
    "host",
    "prefix",
    "folder",
    "starter",
    "gitUrl",
  ]);
  const { choice } = values.starter;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h1>Create your first space</h1>
      <p class="sb-help-text">Step 2 of 2</p>
      <FieldErrors errors={other} />
      <label for="setup-primary-url">Server address</label>
      <Input
        id="setup-primary-url"
        type="url"
        required
        value={primaryUrl}
        onInput={(e) => onPrimaryUrlChange(e.currentTarget.value)}
      />
      <p class="sb-help-text">
        Where people reach this server for management and sign-in.
      </p>
      <h2>Start from</h2>
      {kitsFailed ? (
        <Alert variant="error">Could not load the starter kits.</Alert>
      ) : !kits ? (
        <p>Loading…</p>
      ) : (
        <StarterGallery
          showGit
          selectedId={choice.type === "kit" ? choice.id : "git"}
          kits={kits.map((kit) => ({
            id: kit.id,
            name: kit.name,
            description: kit.description,
            previewUrl: kitPreviewUrl("setup", kit),
          }))}
          onPick={(next: GalleryChoice) => onStarterChange({ choice: next })}
        />
      )}
      <InlineError id="setup-starter-error" message={byField.starter} />
      {choice.type === "git" && (
        <>
          <label for="setup-git-url">Git repository URL</label>
          <Input
            id="setup-git-url"
            placeholder="https://github.com/example/notes"
            aria-invalid={!!byField.gitUrl}
            aria-describedby={
              byField.gitUrl ? "setup-git-url-error" : undefined
            }
            value={values.starter.gitUrl}
            onInput={(e) => onStarterChange({ gitUrl: e.currentTarget.value })}
          />
          <InlineError id="setup-git-url-error" message={byField.gitUrl} />
          <p class="sb-help-text">
            The files of a public repository are copied once, as a starting
            point.
          </p>
        </>
      )}
      <label for="setup-space-name">Name of your first space</label>
      <Input
        id="setup-space-name"
        aria-invalid={!!byField.name}
        aria-describedby={byField.name ? "setup-space-name-error" : undefined}
        value={values.name}
        onInput={(e) => onNameInput(e.currentTarget.value)}
      />
      <InlineError id="setup-space-name-error" message={byField.name} />
      <BindingFields
        binding={values.binding}
        primaryUrl={primaryUrl}
        spaces={[]}
        onInput={onBindingChange}
        error={byField.host ?? byField.prefix}
      />
      <label for="setup-folder">Folder</label>
      <FolderPicker
        id="setup-folder"
        value={values.folder}
        onChange={onFolderChange}
        apiBase="/.setup/api"
        placeholder={defaultFolder(root, values.name)}
        browseStart={parentDir(values.folder) || "/"}
      />
      <InlineError id="setup-folder-error" message={byField.folder} />
      {choice.type === "kit" && values.starter.hasNotes && (
        <Alert variant="info">{HAS_NOTES_WARNING}</Alert>
      )}
      <label for="setup-revisions">Revisions</label>
      <Select
        id="setup-revisions"
        value={values.revisions}
        onChange={(e) =>
          onRevisionsChange(e.currentTarget.value as RevisionsMode)
        }
      >
        <option value="disabled">
          Disabled: revision support switched off
        </option>
        <option value="managed">
          Managed: SilverBullet periodically commits automatically
        </option>
        <option value="unmanaged">
          Unmanaged: show revisions only, no auto commit
        </option>
      </Select>
      <div class="row">
        <Button onClick={onBack}>Back</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          Finish setup
        </Button>
      </div>
    </form>
  );
}
