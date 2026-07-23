import { Fragment } from "preact";
import {
  Button,
  Input,
  UrlPrefixInput,
} from "@silverbulletmd/silverbullet/ui";
import { FolderPicker } from "../../FolderPicker.tsx";
import { FieldErrors } from "../../space_fields.tsx";
import type { FieldError } from "../../types.ts";
import {
  defaultFolder,
  type Hosting,
  parentDir,
  type SpaceValues,
} from "../../wizard.ts";

/**
 * Step 2 of the setup wizard: the first space. Controlled like `AdminStep`,
 * with one wrinkle — `onNameInput` is separate from the other setters because
 * typing a name also reseeds the prefix and folder defaults, which the wizard
 * tracks (see `useSlugDefaults`).
 */
export function SpaceStep({
  values,
  root,
  onNameInput,
  onHostingChange,
  onPrefixChange,
  onFolderChange,
  errors,
  busy,
  onBack,
  onSubmit,
}: {
  values: SpaceValues;
  /** The server's absolute data root, used for the folder placeholder. */
  root: string;
  onNameInput: (name: string) => void;
  onHostingChange: (hosting: Hosting) => void;
  onPrefixChange: (prefix: string) => void;
  onFolderChange: (folder: string) => void;
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
      <label>Hosting</label>
      <label>
        <input
          type="radio"
          name="hosting"
          checked={values.hosting === "root"}
          onChange={() => onHostingChange("root")}
        />{" "}
        Host at the root of this server (/)
        <span class="sb-help-text">
          Only recommended if you intend to create only a <em>single space</em>{" "}
          or using individual (sub)domains for additional spaces.
        </span>
      </label>
      <label>
        <input
          type="radio"
          name="hosting"
          checked={values.hosting === "prefix"}
          onChange={() => onHostingChange("prefix")}
        />{" "}
        Host under a URL prefix
      </label>
      {values.hosting === "prefix" && (
        <Fragment>
          <label for="setup-prefix">Prefix</label>
          <UrlPrefixInput
            id="setup-prefix"
            origin={location.origin}
            value={values.prefix}
            onInput={onPrefixChange}
          />
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
      <div class="row">
        <Button onClick={onBack}>Back</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          Finish setup
        </Button>
      </div>
    </form>
  );
}
