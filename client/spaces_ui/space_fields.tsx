import { useState } from "preact/hooks";
import { Alert, Input } from "@silverbulletmd/silverbullet/ui";
import { slugify } from "./slugify.ts";
import type { FieldError } from "./types.ts";

/**
 * Name → prefix + folder defaults, each stopping once the user edits it by
 * hand. Both the setup wizard and the admin space form need exactly this; they
 * differ only in the folder template, so that is a parameter.
 */
export function useSlugDefaults(folderTemplate: (slug: string) => string) {
  const [prefix, setPrefix] = useState("");
  const [folder, setFolder] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [folderTouched, setFolderTouched] = useState(false);

  function onNameChange(name: string) {
    const slug = slugify(name);
    if (!prefixTouched) setPrefix(slug ? `/${slug}` : "");
    if (!folderTouched) setFolder(slug ? folderTemplate(slug) : "");
  }

  return {
    prefix,
    folder,
    folderTouched,
    onNameChange,
    setPrefix: (v: string) => {
      setPrefix(v);
      setPrefixTouched(true);
    },
    setFolder: (v: string) => {
      setFolder(v);
      setFolderTouched(true);
    },
  };
}

/** The prefix field, decorated with the origin it will be served from. */
export function UrlPrefixInput({
  id,
  value,
  onInput,
}: {
  id: string;
  value: string;
  onInput: (v: string) => void;
}) {
  return (
    <div class="sb-url-input">
      <span class="sb-url-affix">{location.origin}</span>
      <Input
        id={id}
        value={value}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
    </div>
  );
}

/** Server-returned field errors, rendered the same way on every form. */
export function FieldErrors({ errors }: { errors: FieldError[] }) {
  return (
    <>
      {errors.map((e, i) => (
        <Alert variant="error" key={`${e.field}-${i}`}>
          {e.field ? `${e.field}: ${e.message}` : e.message}
        </Alert>
      ))}
    </>
  );
}
