import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api.ts";

export function FolderField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!value) {
        setStatus("");
        return;
      }
      try {
        const r = await api(
          "GET",
          `api/fs/dirs?path=${encodeURIComponent(value)}`,
        );
        setStatus(r.status);
      } catch {
        /* transient */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <Fragment>
      <label for="space-folder">Folder</label>
      <input
        id="space-folder"
        type="text"
        value={value}
        placeholder="spaces/…"
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      {value && status === "exists" && (
        <span class="sb-admin-ok">✓ directory exists</span>
      )}
      {value && status === "missing" && <span>will be created</span>}
      {value && status === "notADirectory" && (
        <span class="sb-admin-error">not a directory</span>
      )}
    </Fragment>
  );
}
