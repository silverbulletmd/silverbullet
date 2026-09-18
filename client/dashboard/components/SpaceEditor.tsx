import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { Alert, SectionNav } from "@silverbulletmd/silverbullet/ui";
import { adminApi, formatApiError } from "../api.ts";
import { spaceUrl } from "../bindings.ts";
import { setNavigationGuard, useNavigate } from "../navigation.ts";
import { dashboardUrl } from "../routes.ts";
import {
  applySpacePatch,
  SPACE_SECTIONS,
  type SpaceSection,
} from "../space_settings.ts";
import type { SpaceInfo } from "../types.ts";
import { SpaceForm } from "./SpaceForm.tsx";
import { GitSyncPage } from "./GitSyncPage.tsx";

export function SpaceEditor({
  id,
  section = "general",
  onUnauthorized,
}: {
  id?: string;
  section?: SpaceSection;
  onUnauthorized: () => void;
}) {
  const navigate = useNavigate();
  const leaving = useRef(false);
  const [space, setSpace] = useState<SpaceInfo>();
  const [loaded, setLoaded] = useState(!id);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [dirty, setDirty] = useState<SpaceSection[]>([]);
  const [gitDirty, setGitDirty] = useState(false);
  const [gitEditing, setGitEditing] = useState(false);
  const gitDraftChanged = useCallback((open: boolean, changed: boolean) => {
    setGitEditing(open);
    setGitDirty(changed);
  }, []);
  const [visitedGit, setVisitedGit] = useState(section === "revisions");
  const base = dashboardUrl(`/${encodeURIComponent(id ?? "")}`);
  const sectionUrl = (value: SpaceSection) =>
    value === "general" ? base : `${base}?section=${value}`;
  const isDirty = (value: SpaceSection) =>
    dirty.includes(value) || (value === "revisions" && gitDirty);
  const pending = dirty.length > 0 || gitDirty;

  useEffect(() => {
    if (section === "revisions") setVisitedGit(true);
  }, [section]);
  useLayoutEffect(() => {
    if (!pending) return;
    const release = setNavigationGuard((destination) => {
      if (leaving.current) return true;
      const url = new URL(destination ?? "", location.href);
      if (
        destination &&
        url.origin === location.origin &&
        [base, `${base}/git`].includes(url.pathname.replace(/\/+$/, ""))
      )
        return true;
      return window.confirm("Discard your unsaved space settings and leave?");
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      release();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [pending, base]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    adminApi("GET", `spaces/${encodeURIComponent(id)}`)
      .then((value) => {
        if (active) {
          setSpace(value);
          setError("");
          setLoaded(true);
        }
      })
      .catch((cause: any) => {
        if (!active) return;
        if (cause.unauthorized) onUnauthorized();
        else if (cause.notFound) setNotFound(true);
        else
          setError(
            refresh
              ? `Could not refresh space settings: ${formatApiError(cause)}`
              : formatApiError(cause),
          );
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [id, refresh]);
  const saved = useCallback(
    (savedId: string, patch?: Partial<SpaceInfo>) => {
      if (!id) navigate(dashboardUrl(`/${encodeURIComponent(savedId)}`));
      else {
        setSpace((value) => value && applySpacePatch(value, patch ?? {}));
        if (patch?.binding) setRefresh((value) => value + 1);
      }
    },
    [id, navigate],
  );

  if (!loaded)
    return <p class="sb-management-main sb-management-status">Loading…</p>;
  if (notFound)
    return (
      <div class="sb-management-main sb-management-status">
        <h1>Space not found</h1>
        <a href={dashboardUrl("/")}>Return to spaces</a>
      </div>
    );
  if (error && !space)
    return (
      <div class="sb-management-main sb-management-status">
        <Alert variant="error">{error}</Alert>
      </div>
    );
  const form = (
    <SpaceForm
      id={id}
      initial={space}
      section={section}
      onSaved={saved}
      onDirtyChange={setDirty}
      connectionDraft={gitEditing}
      cancelHref={dashboardUrl("/")}
      onDeleted={() => {
        leaving.current = true;
        setDirty([]);
        setGitDirty(false);
        location.assign(dashboardUrl("/"));
      }}
      onUnauthorized={onUnauthorized}
    />
  );
  if (!id || !space) return form;
  return (
    <main class="sb-space-settings">
      <header class="sb-settings-heading">
        <div>
          <h1>{space.name}</h1>
        </div>
        <a
          class="sb-button"
          href={spaceUrl(space.binding)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open space ↗
        </a>
      </header>
      <div class="sb-settings-layout">
        <SectionNav
          horizontal
          label="Space settings"
          active={section}
          items={Object.entries(SPACE_SECTIONS).map(([id, label]) => ({
            id,
            label,
            href: sectionUrl(id as SpaceSection),
            dirty: isDirty(id as SpaceSection),
          }))}
          onSelect={(id) => navigate(sectionUrl(id as SpaceSection))}
        />
        <div class="sb-settings-content">
          {error && <Alert variant="error">{error}</Alert>}
          {form}
          {visitedGit && (
            <div hidden={section !== "revisions"}>
              <GitSyncPage
                spaceId={id}
                spaceInfo={space}
                onDraftChange={gitDraftChanged}
                onUnauthorized={onUnauthorized}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
