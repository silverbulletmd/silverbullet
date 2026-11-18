import { Button, Input, Select } from "@silverbulletmd/silverbullet/ui";
import { FolderPicker } from "../../FolderPicker.tsx";
import { splitFieldErrors } from "../../field_errors.ts";
import { FieldErrors, InlineError } from "../../space_fields.tsx";
import type { Binding, FieldError, RevisionsMode } from "../../types.ts";
import { defaultFolder, parentDir, type SpaceValues } from "../../wizard.ts";
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
  ]);
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
