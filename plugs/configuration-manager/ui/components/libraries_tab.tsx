import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ExternalLink, RefreshCw, Trash2, X } from "preact-feather";
import * as editor from "../../../../plug-api/syscalls/editor.ts";
import * as markdown from "../../../../plug-api/syscalls/markdown.ts";
import {
  type InstallableLibrary,
  type InstalledLibrary,
  REPOSITORY_PAGE_PREFIX as REPO_PREFIX,
  type RepositoryInfo,
  type RoguePlug,
  STD_REPOSITORY as STD_REPO,
  suggestRepoNameFromUri,
} from "../../libraries.ts";
import { useCfg } from "../cfg_context.tsx";
import { useLibraries } from "../editors_context.tsx";
import type { LibrariesFocus } from "../types.ts";
import { cls } from "./chord_display.tsx";

function openPage(name: string) {
  void (async () => {
    await editor.navigate(name);
    await editor.hidePanel("modal");
    await editor.focus();
  })();
}

function Spinner() {
  return <span class="cfg-spinner" />;
}

function InlineBanner({
  message,
  kind,
  onDismiss,
}: {
  message?: string;
  kind: "error" | "info";
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div class={`lib-banner lib-${kind}`}>
      <span>{message}</span>
      <button
        type="button"
        class="lib-banner-dismiss"
        title="Dismiss"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function SectionBanners({ section }: { section: "installed" | "available" | "repositories" }) {
  const libs = useLibraries();
  return (
    <>
      <InlineBanner
        kind="error"
        message={libs.errors[section]}
        onDismiss={() => libs.setSectionError(section, undefined)}
      />
      <InlineBanner
        kind="info"
        message={libs.infos[section]}
        onDismiss={() => libs.setSectionInfo(section, undefined)}
      />
    </>
  );
}

// ---------- Confirm button ----------

function ConfirmIconButton({
  icon,
  title,
  confirmLabel,
  onConfirm,
  busy,
}: {
  icon: ComponentChildren;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (busy) {
    return (
      <button class="lib-icon-btn" disabled>
        <Spinner />
      </button>
    );
  }
  if (!armed) {
    return (
      <button
        class="lib-icon-btn lib-danger"
        title={title}
        onClick={() => setArmed(true)}
      >
        {icon}
      </button>
    );
  }
  return (
    <span class="lib-confirm-group">
      <button
        class="cfg-btn lib-danger"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button class="cfg-btn" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

// ---------- Installed ----------

function InstalledRow({
  lib,
  query,
}: {
  lib: InstalledLibrary;
  query: string;
}) {
  const libs = useLibraries();
  const updateKey = `installed:update:${lib.name}`;
  const removeKey = `installed:remove:${lib.name}`;
  const updateBusy = libs.isBusy(updateKey);
  const removeBusy = libs.isBusy(removeKey);
  if (query && !lib.name.toLowerCase().includes(query)) return null;
  const isBuiltin = lib.name.startsWith("Library/Std/") || !lib.uri;
  const isPull = !isBuiltin && lib.mode === "pull";
  const isPush = !isBuiltin && lib.mode === "push";
  return (
    <div class="lib-row">
      <div class="lib-row-main">
        <a class="lib-link" onClick={() => openPage(lib.name)}>
          {lib.name}
        </a>
        {isBuiltin && (
          <span class="lib-badge lib-badge-builtin">built-in</span>
        )}
        {isPush && <span class="lib-badge lib-badge-push">dev mode</span>}
        {isPull && <span class="lib-badge lib-badge-pull">installed</span>}
      </div>
      <div class="lib-row-actions">
        {lib.uri && /^https?:\/\//.test(lib.uri) && (
          <a
            class="lib-icon-btn"
            href={lib.uri}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open source: ${lib.uri}`}
          >
            <ExternalLink size={16} />
          </a>
        )}
        {isPull && (
          <button
            class="lib-icon-btn"
            title="Update"
            disabled={updateBusy || removeBusy}
            onClick={async () => {
              const r = await libs.run(updateKey, "installed", "update", {
                name: lib.name,
              });
              if (r.ok) {
                libs.setSectionInfo(
                  "installed",
                  r.data?.changed
                    ? `Updated ${lib.name}`
                    : `${lib.name} is already up to date`,
                );
              }
            }}
          >
            {updateBusy ? <Spinner /> : <RefreshCw size={16} />}
          </button>
        )}
        {isPull && (
          <ConfirmIconButton
            icon={<Trash2 size={16} />}
            title="Remove library"
            confirmLabel="Confirm remove"
            busy={removeBusy}
            onConfirm={() =>
              libs.run(removeKey, "installed", "remove", { name: lib.name })
            }
          />
        )}
      </div>
    </div>
  );
}

function RoguePlugRow({ plug, query }: { plug: RoguePlug; query: string }) {
  const libs = useLibraries();
  const key = `plug:remove:${plug.path}`;
  const busy = libs.isBusy(key);
  if (query && !plug.path.toLowerCase().includes(query)) return null;
  return (
    <div class="lib-row">
      <div class="lib-row-main">
        <span>{plug.path}</span>
        <span class="lib-badge lib-badge-push">Plug</span>
      </div>
      <div class="lib-row-actions">
        <ConfirmIconButton
          icon={<Trash2 size={16} />}
          title="Remove plug"
          confirmLabel="Confirm remove"
          busy={busy}
          onConfirm={() =>
            libs.run(key, "installed", "removePlug", { path: plug.path })
          }
        />
      </div>
    </div>
  );
}

function InstalledSection({ query }: { query: string }) {
  const libs = useLibraries();
  const installed = libs.data.installed;
  const rogue = libs.data.roguePlugs;
  const hasPull = installed.some((l) => l.mode === "pull");
  const visibleLibs = installed.filter(
    (l) => !query || l.name.toLowerCase().includes(query),
  );
  const visibleRogue = rogue.filter(
    (p) => !query || p.path.toLowerCase().includes(query),
  );
  const empty = visibleLibs.length === 0 && visibleRogue.length === 0;
  return (
    <div class="lib-section">
      <div class="lib-section-header">
        <h2>Installed</h2>
        {hasPull && <UpdateAllButton />}
      </div>
      <SectionBanners section="installed" />
      {empty && (
        <div class="lib-empty">
          No libraries installed yet — install one from Available below.
        </div>
      )}
      {visibleLibs.map((lib) => (
        <InstalledRow key={lib.name} lib={lib} query={query} />
      ))}
      {visibleRogue.map((p) => (
        <RoguePlugRow key={p.path} plug={p} query={query} />
      ))}
    </div>
  );
}

function UpdateAllButton() {
  const libs = useLibraries();
  const progress = libs.updateAllProgress;
  const busy = progress.running;

  async function run() {
    const targets = libs.data.installed.filter(
      (l) => l.mode === "pull" && l.uri,
    );
    if (targets.length === 0) {
      libs.setSectionInfo("installed", "Nothing to update");
      return;
    }
    libs.setSectionError("installed", undefined);
    libs.setUpdateAllProgress({
      running: true,
      done: 0,
      total: targets.length,
      current: "",
    });
    const updated: string[] = [];
    let firstError: string | undefined;
    for (let i = 0; i < targets.length; i++) {
      const lib = targets[i];
      libs.setUpdateAllProgress({
        running: true,
        done: i,
        total: targets.length,
        current: lib.name,
      });
      const r = await libs.run(
        `installed:update:${lib.name}`,
        "installed",
        "update",
        { name: lib.name },
      );
      if (r.ok) {
        if (r.data?.changed) updated.push(lib.name);
      } else if (!firstError) {
        firstError = `${lib.name}: ${r.error}`;
      }
    }
    libs.setUpdateAllProgress({
      running: false,
      done: targets.length,
      total: targets.length,
      current: "",
    });
    if (firstError) libs.setSectionError("installed", firstError);
    libs.setSectionInfo(
      "installed",
      updated.length === 0
        ? "All libraries already up to date"
        : `Updated ${updated.length} librar${
            updated.length === 1 ? "y" : "ies"
          }: ${updated.join(", ")}`,
    );
  }

  return (
    <div class="lib-updateall">
      <button class="cfg-btn" disabled={busy} onClick={() => void run()}>
        {busy ? (
          <>
            <Spinner />
            Updating {progress.done}/{progress.total}…
          </>
        ) : (
          "Update all"
        )}
      </button>
      {busy && (
        <div class="lib-progress">
          <div
            class="lib-progress-bar"
            style={{
              width: `${
                progress.total === 0
                  ? 0
                  : Math.round((progress.done / progress.total) * 100)
              }%`,
            }}
          />
          {progress.current && (
            <div class="lib-progress-label">{progress.current}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Available ----------

function MarkdownDescription({ text }: { text: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let active = true;
    markdown
      .markdownToHtml(text)
      .then((h) => {
        if (active) setHtml(h);
      })
      .catch(() => {
        if (active) setHtml("");
      });
    return () => {
      active = false;
    };
  }, [text]);
  return (
    <div
      class="lib-card-desc"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function AvailableCard({ lib }: { lib: InstallableLibrary }) {
  const libs = useLibraries();
  const key = `install:${lib.uri}`;
  const busy = libs.isBusy(key);
  const titleHref = lib.website || lib.uri;
  return (
    <div class="lib-card">
      <div class="lib-card-head">
        <div class="lib-card-title">
          {titleHref ? (
            <a
              class="lib-link"
              href={titleHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>{lib.name}</strong>
            </a>
          ) : (
            <strong>{lib.name}</strong>
          )}
        </div>
        <button
          class="cfg-btn cfg-btn-primary"
          disabled={busy}
          onClick={() =>
            libs.run(key, "available", "install", { uri: lib.uri })
          }
        >
          {busy ? (
            <>
              <Spinner />
              Installing…
            </>
          ) : (
            "Install"
          )}
        </button>
      </div>
      {lib.description && <MarkdownDescription text={lib.description} />}
    </div>
  );
}

function AvailableSection({
  query,
  focusInstall,
}: {
  query: string;
  focusInstall: boolean;
}) {
  const libs = useLibraries();
  const [uri, setUri] = useState("");
  const [plugPath, setPlugPath] = useState("");
  const [plugPathEdited, setPlugPathEdited] = useState(false);
  const [showUriForm, setShowUriForm] = useState(focusInstall);
  const uriInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showUriForm) uriInput.current?.focus();
  }, [showUriForm]);
  const isPlug = uri.endsWith(".plug.js");
  const suggestedPlugPath = (() => {
    if (!isPlug) return "";
    const segs = uri.split("/");
    return segs[segs.length - 1] || "";
  })();

  const grouped = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = libs.data.installable.filter((lib) => {
      if (!q) return true;
      return (
        lib.name.toLowerCase().includes(q) ||
        (lib.description || "").toLowerCase().includes(q) ||
        (lib.page || "").toLowerCase().includes(q)
      );
    });
    const groups = new Map<string, InstallableLibrary[]>();
    for (const lib of filtered) {
      const repo = lib.repositoryPage || "(unknown)";
      if (!groups.has(repo)) groups.set(repo, []);
      groups.get(repo)!.push(lib);
    }
    const entries = [...groups.entries()];
    entries.sort(([a], [b]) => {
      if (a === STD_REPO) return -1;
      if (b === STD_REPO) return 1;
      return a.localeCompare(b);
    });
    return entries;
  }, [libs.data.installable, query]);

  const installKey = "install:uri";
  const installBusy = libs.isBusy(installKey);

  return (
    <div class="lib-section">
      <div class="lib-section-header">
        <h2>Available</h2>
        {!showUriForm && (
          <button class="cfg-btn" onClick={() => setShowUriForm(true)}>
            Install from URI…
          </button>
        )}
      </div>
      <SectionBanners section="available" />
      {showUriForm && (
        <form
          class="lib-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!uri || installBusy) return;
            const effectivePath = plugPathEdited
              ? plugPath
              : suggestedPlugPath;
            const result = isPlug
              ? await libs.run(installKey, "available", "installPlug", {
                  uri,
                  path: effectivePath,
                })
              : await libs.run(installKey, "available", "install", { uri });
            if (result.ok) {
              setUri("");
              setPlugPath("");
              setPlugPathEdited(false);
              setShowUriForm(false);
            }
          }}
        >
          <input
            ref={uriInput}
            type="text"
            placeholder="Library or plug URI (https://… or github:…)"
            value={uri}
            onInput={(e) => {
              setUri((e.currentTarget as HTMLInputElement).value);
              if (!plugPathEdited) setPlugPath("");
            }}
          />
          {isPlug && (
            <input
              type="text"
              placeholder="Save plug as (path)"
              value={plugPathEdited ? plugPath : suggestedPlugPath}
              onInput={(e) => {
                setPlugPath((e.currentTarget as HTMLInputElement).value);
                setPlugPathEdited(true);
              }}
            />
          )}
          <button
            class="cfg-btn cfg-btn-primary"
            disabled={
              installBusy ||
              !uri ||
              (isPlug && !(plugPathEdited ? plugPath : suggestedPlugPath))
            }
          >
            {installBusy ? (
              <>
                <Spinner />
                Installing…
              </>
            ) : (
              "Install"
            )}
          </button>
          <button
            type="button"
            class="cfg-btn"
            disabled={installBusy}
            onClick={() => {
              setUri("");
              setPlugPath("");
              setPlugPathEdited(false);
              setShowUriForm(false);
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {grouped.length === 0 && (
        <div class="lib-empty">
          No libraries available. Add a repository below to discover more.
        </div>
      )}
      {grouped.map(([repo, list]) => (
        <RepoGroup key={repo} repo={repo} list={list} />
      ))}
    </div>
  );
}

function RepoGroup({
  repo,
  list,
}: {
  repo: string;
  list: InstallableLibrary[];
}) {
  const [open, setOpen] = useState(true);
  const isStd = repo === STD_REPO;
  const label = isStd
    ? "Recommended (Std)"
    : repo.startsWith(REPO_PREFIX)
      ? repo.slice(REPO_PREFIX.length)
      : repo;
  return (
    <div class={cls({ "lib-group": true, "lib-group-recommended": isStd })}>
      <div class="lib-group-head" onClick={() => setOpen((v) => !v)}>
        <span class="lib-group-caret">{open ? "▾" : "▸"}</span>
        <span class="lib-group-label">{label}</span>
        <span class="lib-group-count">({list.length})</span>
      </div>
      {open && (
        <div class="lib-group-body">
          {list.map((lib) => (
            <AvailableCard key={lib.uri} lib={lib} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Repositories ----------

function RepoRow({ repo }: { repo: RepositoryInfo }) {
  const libs = useLibraries();
  const key = `repo:${repo.name}`;
  const busy = libs.isBusy(key);
  const actionable = !!repo.uri; // repos without share metadata (e.g. built-in Std) are read-only
  return (
    <div class="lib-row">
      <div class="lib-row-main">
        <a class="lib-link" onClick={() => openPage(repo.name)}>
          {repo.name}
        </a>
        {repo.uri && (
          <span class="lib-uri" title={repo.uri}>
            {repo.uri}
          </span>
        )}
        {!actionable && (
          <span class="lib-badge lib-badge-builtin">built-in</span>
        )}
      </div>
      <div class="lib-row-actions">
        {repo.uri && /^https?:\/\//.test(repo.uri) && (
          <a
            class="lib-icon-btn"
            href={repo.uri}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open source: ${repo.uri}`}
          >
            <ExternalLink size={16} />
          </a>
        )}
        {actionable && (
          <>
            <button
              class="lib-icon-btn"
              title="Update"
              disabled={busy}
              onClick={async () => {
                const r = await libs.run(
                  key,
                  "repositories",
                  "updateRepository",
                  { name: repo.name },
                );
                if (r.ok) {
                  libs.setSectionInfo(
                    "repositories",
                    r.data?.changed
                      ? `Updated ${repo.name}`
                      : `${repo.name} is already up to date`,
                  );
                }
              }}
            >
              {busy ? <Spinner /> : <RefreshCw size={16} />}
            </button>
            <ConfirmIconButton
              icon={<Trash2 size={16} />}
              title="Remove repository"
              confirmLabel="Confirm remove"
              busy={busy}
              onConfirm={() =>
                libs.run(key, "repositories", "removeRepository", {
                  name: repo.name,
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function RepoAddForm({ autoOpen }: { autoOpen: boolean }) {
  const libs = useLibraries();
  const [open, setOpen] = useState(autoOpen);
  const [uri, setUri] = useState("");
  const [page, setPage] = useState("");
  const uriRef = useRef<HTMLInputElement>(null);
  const key = "repo:add";
  const busy = libs.isBusy(key);

  useEffect(() => {
    if (open) uriRef.current?.focus();
  }, [open]);

  return (
    <div>
      <button class="cfg-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide add form" : "Add repository…"}
      </button>
      {open && (
        <form
          class="lib-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!uri || !page || busy) return;
            const result = await libs.run(
              key,
              "repositories",
              "addRepository",
              { uri, page },
            );
            if (result.ok) {
              setUri("");
              setPage("");
              setOpen(false);
            }
          }}
        >
          <input
            ref={uriRef}
            type="text"
            placeholder="Repository URI"
            value={uri}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              setUri(v);
              if (v) setPage(`${REPO_PREFIX}${suggestRepoNameFromUri(v)}`);
            }}
          />
          <input
            type="text"
            placeholder="Install into (page path)"
            value={page}
            onInput={(e) =>
              setPage((e.currentTarget as HTMLInputElement).value)
            }
          />
          <button
            class="cfg-btn cfg-btn-primary"
            disabled={busy || !uri || !page}
          >
            {busy ? (
              <>
                <Spinner />
                Adding…
              </>
            ) : (
              "Add"
            )}
          </button>
        </form>
      )}
    </div>
  );
}

function RepoUpdateAllButton() {
  const libs = useLibraries();
  const key = "repo:updateAll";
  const busy = libs.isBusy(key);
  return (
    <button
      class="cfg-btn"
      disabled={busy}
      onClick={async () => {
        const r = await libs.run(
          key,
          "repositories",
          "updateAllRepositories",
        );
        if (r.ok) {
          const updated: string[] = r.data?.updated ?? [];
          libs.setSectionInfo(
            "repositories",
            updated.length === 0
              ? "All repositories already up to date"
              : `Updated ${updated.length} repositor${
                  updated.length === 1 ? "y" : "ies"
                }: ${updated.join(", ")}`,
          );
        }
      }}
    >
      {busy ? (
        <>
          <Spinner />
          Updating…
        </>
      ) : (
        "Update all"
      )}
    </button>
  );
}

function RepositoriesSection({ focusAdd }: { focusAdd: boolean }) {
  const libs = useLibraries();
  return (
    <div class="lib-section">
      <div class="lib-section-header">
        <h2>Repositories</h2>
        <div class="lib-section-actions">
          <RepoAddForm autoOpen={focusAdd} />
          <RepoUpdateAllButton />
        </div>
      </div>
      <SectionBanners section="repositories" />
      {libs.data.repositories.length === 0 && (
        <div class="lib-empty">No repositories yet.</div>
      )}
      {libs.data.repositories.map((r) => (
        <RepoRow key={r.name} repo={r} />
      ))}
    </div>
  );
}

// ---------- Tab root ----------

export function LibrariesTab() {
  const { cfg } = useCfg();
  const libs = useLibraries();
  const [search, setSearch] = useState("");
  const triggered = useRef(false);
  const focus: LibrariesFocus = cfg.librariesFocus ?? "manager";

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    if (focus === "updateAll") {
      void libs.run("installed:updateAll", "installed", "updateAll");
    } else if (focus === "updateAllRepositories") {
      void libs.run("repo:updateAll", "repositories", "updateAllRepositories");
    }
  }, [focus, libs]);

  const query = search.toLowerCase().trim();

  return (
    <>
      <input
        type="text"
        id="cfg-config-search"
        placeholder="Filter libraries…"
        value={search}
        onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
      />
      <InstalledSection query={query} />
      <AvailableSection query={query} focusInstall={focus === "install"} />
      <RepositoriesSection focusAdd={focus === "addRepository"} />
    </>
  );
}
