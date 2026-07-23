import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Input } from "@silverbulletmd/silverbullet/ui";

/**
 * Reusable server-side folder picker shared by the setup wizard
 * (`apiBase="/.setup/api"`) and the space manager (`apiBase="api/admin"`), both
 * built from `client/spaces_ui`. It is deliberately functional rather than
 * fancy:
 *
 * - a text input for typing a path directly (relative paths resolve against
 *   the server root; absolute paths are allowed),
 * - a debounced status line driven by `GET <apiBase>/fs/dirs?path=…`
 *   (exists / will be created / not a directory / not writable),
 * - an optional "Browse…" panel that walks the server's directory tree using
 *   the same endpoint's `suggestions`: breadcrumb segments ascend, the
 *   subdirectory list descends. Every navigation immediately prefills the
 *   text input with the current path — extend it by hand afterwards if the
 *   target folder doesn't exist yet.
 *
 * The endpoint answers `{ status, writable, suggestions }`; see the server's
 * `dir_completion`. This component owns its own `fetch` (no api.ts dependency)
 * so it can be imported by either bundle entry point (`spaces.tsx`,
 * `setup.tsx`).
 */

type DirsResponse = {
  status: "exists" | "missing" | "notADirectory";
  writable: boolean;
  suggestions: string[];
};

async function fetchDirs(
  apiBase: string,
  path: string,
): Promise<DirsResponse | null> {
  try {
    const r = await fetch(
      `${apiBase}/fs/dirs?path=${encodeURIComponent(path)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!r.ok) return null;
    return (await r.json()) as DirsResponse;
  } catch {
    return null;
  }
}

/** Breadcrumb entries for a browse path, outermost (root) first. */
function crumbsFor(path: string): Array<{ label: string; target: string }> {
  const absolute = path.startsWith("/");
  const segments = path.split("/").filter(Boolean);
  const crumbs: Array<{ label: string; target: string }> = [
    { label: absolute ? "/" : "root", target: absolute ? "/" : "" },
  ];
  let acc = absolute ? "" : "";
  for (const seg of segments) {
    acc = acc === "" ? seg : `${acc}/${seg}`;
    crumbs.push({ label: seg, target: absolute ? `/${acc}` : acc });
  }
  return crumbs;
}

export function FolderPicker({
  value,
  onChange,
  apiBase,
  id,
  placeholder = "spaces/notes",
  browseStart,
}: {
  value: string;
  onChange: (v: string) => void;
  apiBase: string;
  id?: string;
  placeholder?: string;
  /**
   * Where "Browse…" opens. Defaults to the current value (list its own
   * subdirectories). The wizard passes the value's *parent*, since its
   * prepopulated `<root>/spaces/<slug>` folder doesn't exist yet — browsing
   * its parent shows the real sibling folders to pick from.
   */
  browseStart?: string;
}) {
  const [status, setStatus] = useState<DirsResponse | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [browseDirs, setBrowseDirs] = useState<string[]>([]);

  /** Browse navigation: descend/ascend AND prefill the input with the path,
   * so picking a folder is just navigating to it (extend by hand for a
   * folder that doesn't exist yet). */
  function navigate(path: string) {
    setBrowsePath(path);
    onChange(path);
  }

  // Debounced status line for the typed value.
  useEffect(() => {
    if (!value) {
      setStatus(null);
      return;
    }
    const t = setTimeout(async () => {
      setStatus(await fetchDirs(apiBase, value));
    }, 300);
    return () => clearTimeout(t);
  }, [value, apiBase]);

  // Listing for the browse panel: subdirectories of `browsePath`.
  useEffect(() => {
    if (!browsing) return;
    let cancelled = false;
    void (async () => {
      const listPath = browsePath ? `${browsePath.replace(/\/+$/, "")}/` : "";
      const r = await fetchDirs(apiBase, listPath);
      if (!cancelled) setBrowseDirs(r?.suggestions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [browsing, browsePath, apiBase]);

  function statusLine() {
    if (!value || !status) return null;
    if (status.status === "exists") {
      return status.writable ? (
        <span class="sb-spaces-ok">✓ directory exists</span>
      ) : (
        <span class="sb-spaces-error">not writable</span>
      );
    }
    if (status.status === "missing") return <span>will be created</span>;
    return <span class="sb-spaces-error">not a directory</span>;
  }

  return (
    <Fragment>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      <div class="sb-folder-picker-status">
        {statusLine()}
        <button
          type="button"
          class="sb-link-button"
          onClick={() => {
            setBrowsing((b) => !b);
            const start = (browseStart ?? value).replace(/\/+$/, "");
            setBrowsePath(start);
          }}
        >
          {browsing ? "Close" : "Browse…"}
        </button>
      </div>
      {browsing && (
        <div class="sb-folder-browser">
          <div class="sb-folder-crumbs">
            {crumbsFor(browsePath).map((c, i, crumbs) => (
              <Fragment key={`${c.target}-${i}`}>
                {/* No separator right after the root crumb — its label is
                    already "/" and a second one would render as "//". */}
                {i > 0 && crumbs[i - 1].label !== "/" && (
                  <span class="sb-folder-crumb-sep">/</span>
                )}
                <button
                  type="button"
                  class="sb-link-button"
                  onClick={() => navigate(c.target)}
                >
                  {c.label}
                </button>
              </Fragment>
            ))}
          </div>
          <ul class="sb-folder-dirs">
            {browseDirs.length === 0 && (
              <li class="sb-folder-empty">No subdirectories</li>
            )}
            {browseDirs.map((dir) => (
              <li key={dir}>
                <button
                  type="button"
                  class="sb-link-button"
                  onClick={() => navigate(dir)}
                >
                  {dir.split("/").filter(Boolean).pop() || dir}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Fragment>
  );
}
