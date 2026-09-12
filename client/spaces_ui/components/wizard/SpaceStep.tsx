import { Fragment } from "preact";
import {
  Button,
  Input,
  Select,
  UrlPrefixInput,
} from "@silverbulletmd/silverbullet/ui";
import { FolderPicker } from "../../FolderPicker.tsx";
import { FieldErrors } from "../../space_fields.tsx";
import type { FieldError, RevisionsMode } from "../../types.ts";
import {
  defaultFolder,
  type Hosting,
  parentDir,
  type SpaceValues,
} from "../../wizard.ts";

export function SpaceStep({
  values,
  root,
  onNameInput,
  primaryUrl,
  onPrimaryUrlChange,
  onHostingChange,
  onPrefixChange,
  onHostChange,
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
  onHostingChange: (hosting: Hosting) => void;
  onPrefixChange: (prefix: string) => void;
  onHostChange: (value: string) => void;
  onFolderChange: (folder: string) => void;
  onRevisionsChange: (revisions: RevisionsMode) => void;
  errors: FieldError[];
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h1>Create your first space</h1>
      <p class="sb-help-text">Step 2 of 2</p>
      <FieldErrors errors={errors} />
      <label for="setup-space-name">Name</label>
      <Input
        id="setup-space-name"
        value={values.name}
        onInput={(e) => onNameInput(e.currentTarget.value)}
      />
      <label for="setup-primary-url">Primary URL</label>
      <Input
        id="setup-primary-url"
        type="url"
        required
        value={primaryUrl}
        onInput={(e) => onPrimaryUrlChange(e.currentTarget.value)}
      />
      <p class="sb-help-text">
        Confirm the public origin for server management and sign-in. The current
        browser origin is suggested.
      </p>
      <label for="setup-hosting">Binding</label>
      <Select
        id="setup-hosting"
        value={values.hosting}
        onChange={(e) =>
          onHostingChange(e.currentTarget.value as "prefix" | "host")
        }
      >
        <option value="prefix">URL prefix (this host)</option>
        <option value="host">Hostname</option>
      </Select>
      {values.hosting === "prefix" ? (
        <Fragment>
          <label for="setup-prefix">Prefix</label>
          <UrlPrefixInput
            id="setup-prefix"
            origin={location.origin}
            value={values.prefix}
            onInput={onPrefixChange}
          />
        </Fragment>
      ) : (
        <Fragment>
          <label for="setup-host">Hostname</label>
          <Input
            id="setup-host"
            required
            value={values.host ?? ""}
            placeholder="notes.example.com"
            onInput={(e) => onHostChange(e.currentTarget.value)}
          />
          <p class="sb-help-text">
            Configure this hostname to reach this server; do not include a
            scheme or path.
          </p>
        </Fragment>
      )}
      <label for="setup-folder">Folder</label>
      <FolderPicker
        id="setup-folder"
        value={values.folder}
        onChange={onFolderChange}
        apiBase="/.setup/api"
        placeholder={defaultFolder(root, values.name)}
        browseStart={parentDir(values.folder) || "/"}
      />
      <label for="setup-revisions">Revisions</label>
      <Select
        id="setup-revisions"
        value={values.revisions}
        onChange={(e) =>
          onRevisionsChange(e.currentTarget.value as RevisionsMode)
        }
      >
        <option value="disabled">
          Disabled — revision support switched off entirely
        </option>
        <option value="managed">
          Managed — SilverBullet periodically commits automatically
        </option>
        <option value="unmanaged">
          Unmanaged — show revisions only, no auto commit
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
