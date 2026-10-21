import { editor, markdown } from "@silverbulletmd/silverbullet/syscalls";
import {
  Alert,
  Badge,
  Button,
  Progress,
} from "@silverbulletmd/silverbullet/ui";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronRight, X } from "preact-feather";
import type { Client } from "../../client.ts";
import { copyText, openRef } from "../shared/action.ts";
import { ActionMenu } from "../shared/action_menu.tsx";
import { BlockNote } from "../shared/block_ui.tsx";
import type { TabProps } from "../tab.ts";
import type { InstallableLibrary } from "./libraries_backend.ts";
import {
  type LibrariesFocus,
  onLibrariesFocus,
  takeLibrariesFocus,
} from "./libraries_focus.ts";
import {
  type AvailableGroup,
  BUSY,
  confirmThen,
  installKey,
  isLoading,
  type Libraries,
  type LibraryRow,
  libraryLists,
  plural,
  READ_ONLY_NOTE,
  removeMessage,
  revertMessage,
  rowActions,
  rowKey,
  type SectionKey,
  toolbar,
  useLibraries,
  whileShowing,
} from "./libraries_model.ts";
import {
  REPOSITORY_PAGE_PREFIX,
  suggestRepoNameFromUri,
} from "./library_names.ts";
import { libraryStatusLabel } from "./library_status.ts";

// Prompt for a library or plug URI (and a plug's save path) and install it
async function promptInstall(libs: Libraries) {
  const uri = (
    await editor.prompt("Library or plug URI (https://… or github:…):")
  )?.trim();
  if (!uri) return;
  if (uri.endsWith(".plug.js")) {
    const segs = uri.split("/");
    const suggested = segs[segs.length - 1] || "";
    const path = (
      await editor.prompt("Save plug as (path):", suggested)
    )?.trim();
    if (!path) return;
    await libs.installPlug(uri, path);
  } else {
    await libs.install(uri, BUSY.install);
  }
}

async function promptAddRepository(libs: Libraries) {
  const uri = (await editor.prompt("Repository URI:"))?.trim();
  if (!uri) return;
  const page = (
    await editor.prompt(
      "Install into (page path):",
      `${REPOSITORY_PAGE_PREFIX}${suggestRepoNameFromUri(uri)}`,
    )
  )?.trim();
  if (!page) return;
  await libs.addRepository(uri, page);
}

function runFocus(libs: Libraries, focus: LibrariesFocus) {
  if (!libs.writable && focus !== "manager") return;
  switch (focus) {
    case "install":
      return promptInstall(libs);
    case "addRepository":
      return promptAddRepository(libs);
    case "updateAll":
      return libs.updateAll();
    case "updateAllRepositories":
      return libs.updateAllRepositories();
  }
}

function Spinner() {
  return <span className="sb-nav-spinner" aria-hidden="true" />;
}

/** A label that turns into a spinner and `busyLabel` while `busy`. */
function Busy(props: {
  busy: boolean;
  busyLabel: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <>
      {props.busy && <Spinner />}
      {props.busy ? props.busyLabel : props.children}
    </>
  );
}

export function LibrariesView({ client, focusTarget, showing }: TabProps) {
  // The write syscalls aren't registered in a read-only space
  const libs = useLibraries(!client.bootConfig.readOnly);
  const { state, writable } = libs;
  const [phrase, setPhrase] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
  const latest = useRef(libs);
  latest.current = libs;

  useEffect(() => {
    const el = filterInput.current;
    return el ? focusTarget(el) : undefined;
  }, [focusTarget]);

  useEffect(() => {
    if (!showing) return;
    return whileShowing({
      reload: () => latest.current.reload(),
      take: takeLibrariesFocus,
      run: (focus) => runFocus(latest.current, focus),
      subscribe: onLibrariesFocus,
    });
  }, [showing]);

  const lists = useMemo(
    () => libraryLists(state.data, phrase, state.checks),
    [state.data, phrase, state.checks],
  );
  const { progress } = state;
  const available = state.data.installable.length;
  const loading = isLoading(state);
  const buttons = toolbar({ writable, updatable: lists.updatable });

  return (
    <div className="sb-workbench sb-wb-libraries">
      <div className="sb-wb-toolbar">
        <input
          ref={filterInput}
          type="search"
          className="sb-wb-filter"
          placeholder="Filter libraries"
          aria-label="Filter libraries"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          value={phrase}
          onInput={(e) => setPhrase(e.currentTarget.value)}
        />
        {buttons.install && (
          <Button
            disabled={libs.isBusy(BUSY.install)}
            onClick={() => void promptInstall(libs)}
          >
            <Busy busy={libs.isBusy(BUSY.install)} busyLabel="Installing…">
              Install…
            </Busy>
          </Button>
        )}
        {buttons.addRepository && (
          <Button
            disabled={libs.isBusy(BUSY.addRepository)}
            onClick={() => void promptAddRepository(libs)}
          >
            <Busy busy={libs.isBusy(BUSY.addRepository)} busyLabel="Adding…">
              Add repository…
            </Busy>
          </Button>
        )}
        {buttons.check && (
          <Button
            disabled={libs.isBusy(BUSY.check)}
            onClick={() => void libs.checkUpdates()}
          >
            <Busy busy={libs.isBusy(BUSY.check)} busyLabel="Checking…">
              Check for updates
            </Busy>
          </Button>
        )}
        {buttons.updateAll && (
          <Button
            title="Update all installed libraries"
            disabled={progress.running}
            onClick={() => void libs.updateAll()}
          >
            <Busy
              busy={progress.running}
              busyLabel={`Updating ${progress.done}/${progress.total}…`}
            >
              Update all
            </Busy>
          </Button>
        )}
      </div>
      {!writable && <BlockNote>{READ_ONLY_NOTE}</BlockNote>}
      {progress.running && (
        <div className="sb-wb-lib-progress">
          <Progress
            value={progress.total === 0 ? 0 : progress.done / progress.total}
          />
          <span className="sb-wb-muted">{progress.current}</span>
        </div>
      )}
      <div className="sb-workbench-body">
        {loading ? (
          <BlockNote>Loading…</BlockNote>
        ) : (
          <>
            <Section
              libs={libs}
              section="installed"
              title="Installed"
              count={lists.installed.length}
            >
              {lists.installed.length === 0 ? (
                <BlockNote>
                  No libraries installed yet — install one from Available below.
                </BlockNote>
              ) : (
                lists.installed.map((row) => (
                  <Row
                    key={`${row.kind}:${row.name}`}
                    client={client}
                    libs={libs}
                    row={row}
                  />
                ))
              )}
            </Section>
            <Section
              libs={libs}
              section="available"
              title="Available"
              count={lists.groups.reduce((n, g) => n + g.libraries.length, 0)}
            >
              {lists.groups.length === 0 ? (
                <BlockNote>
                  No libraries available. Add a repository below to discover
                  more.
                </BlockNote>
              ) : (
                lists.groups.map((g) => (
                  <Group key={g.repo} libs={libs} group={g} />
                ))
              )}
            </Section>
            <Section
              libs={libs}
              section="repositories"
              title="Repositories"
              count={lists.repositories.length}
              actions={
                writable &&
                lists.repositories.length > 0 && (
                  <Button
                    title="Update all repositories"
                    disabled={libs.isBusy(BUSY.updateAllRepositories)}
                    onClick={() => void libs.updateAllRepositories()}
                  >
                    <Busy
                      busy={libs.isBusy(BUSY.updateAllRepositories)}
                      busyLabel="Updating…"
                    >
                      Update all
                    </Busy>
                  </Button>
                )
              }
            >
              {lists.repositories.length === 0 ? (
                <BlockNote>No repositories yet.</BlockNote>
              ) : (
                lists.repositories.map((row) => (
                  <Row key={row.name} client={client} libs={libs} row={row} />
                ))
              )}
            </Section>
          </>
        )}
      </div>
      {!loading && (
        <div className="sb-wb-footer">
          <span>
            {plural(state.data.installed.length, "library", "libraries")}
          </span>
          <span>
            {plural(
              state.data.repositories.length,
              "repository",
              "repositories",
            )}
          </span>
          <span>{available.toLocaleString()} available</span>
          {state.checkedAt !== undefined && (
            <span>
              checked{" "}
              {new Date(state.checkedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Section(props: {
  libs: Libraries;
  section: SectionKey;
  title: string;
  count: number;
  actions?: ComponentChildren;
  children: ComponentChildren;
}) {
  const { libs, section } = props;
  return (
    <section className="sb-wb-lib-section" aria-label={props.title}>
      <div className="sb-wb-lib-head">
        <h3 className="sb-wb-lib-title">{props.title}</h3>
        <span className="sb-wb-lib-count">{props.count.toLocaleString()}</span>
        {props.actions ? (
          <div className="sb-wb-lib-head-actions">{props.actions}</div>
        ) : null}
      </div>
      <Banner
        kind="error"
        message={libs.state.errors[section]}
        onDismiss={() => libs.setError(section, undefined)}
      />
      <Banner
        kind="info"
        message={libs.state.infos[section]}
        onDismiss={() => libs.setInfo(section, undefined)}
      />
      {props.children}
    </section>
  );
}

function Banner(props: {
  kind: "error" | "info";
  message?: string;
  onDismiss: () => void;
}) {
  if (!props.message) return null;
  return (
    <Alert variant={props.kind} class="sb-wb-lib-banner">
      <span role={props.kind === "error" ? "alert" : "status"}>
        {props.message}
      </span>
      <Button variant="icon" title="Dismiss" onClick={props.onDismiss}>
        <X size={14} />
      </Button>
    </Alert>
  );
}

/** A library, stray plug or repository; clicking it opens its page. */
function Row({
  client,
  libs,
  row,
}: {
  client: Client;
  libs: Libraries;
  row: LibraryRow;
}) {
  const busy = libs.isBusy(rowKey(row));
  const status = libraryStatusLabel(row.check);
  const open = () => openRef(client, { path: `${row.name}.md` });
  const ask = (message: string, act: () => Promise<unknown>) =>
    confirmThen(row, message, act, {
      confirm: (m) => editor.confirm(m, { destructive: true }),
      setError: libs.setError,
    });
  const actions = rowActions(row, libs.writable, {
    update: () => libs.updateOne(row),
    revert: () => ask(revertMessage(row), () => libs.revertOne(row)),
    remove: () => ask(removeMessage(row), () => libs.removeOne(row)),
    open,
    copy: () => copyText(client, row.uri ?? ""),
  });
  return (
    <div
      className={`sb-wb-lib-row${row.openable ? " sb-wb-lib-openable" : ""}`}
      title={row.name}
      onClick={row.openable ? () => void open() : undefined}
    >
      <div
        className="sb-wb-lib-main"
        role={row.openable ? "button" : undefined}
        tabIndex={row.openable ? 0 : undefined}
        onKeyDown={
          row.openable
            ? (e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  void open();
                }
              }
            : undefined
        }
      >
        <span className="sb-wb-lib-name">{row.name}</span>
        {row.badge && (
          <Badge
            class={`sb-wb-lib-badge sb-wb-lib-${row.badge.replace(" ", "-").toLowerCase()}`}
          >
            {row.badge}
          </Badge>
        )}
        {status && (
          <span title={status.title}>
            <Badge class={`sb-wb-lib-badge sb-wb-lib-tone-${status.tone}`}>
              {status.label}
            </Badge>
          </span>
        )}
        {row.uri && <Uri uri={row.uri} />}
      </div>
      <div className="sb-wb-lib-actions">
        {busy ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Spinner />
          </span>
        ) : (
          <ActionMenu actions={actions} deps={undefined} />
        )}
      </div>
    </div>
  );
}

/** The share URI, muted; a web address links to its source. */
function Uri({ uri }: { uri: string }) {
  if (/^https?:\/\//.test(uri)) {
    return (
      <a
        className="sb-wb-lib-uri sb-wb-muted"
        href={uri}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open source: ${uri}`}
        onClick={(e) => e.stopPropagation()}
      >
        {uri}
      </a>
    );
  }
  return (
    <span className="sb-wb-lib-uri sb-wb-muted" title={uri}>
      {uri}
    </span>
  );
}

function Group({ libs, group }: { libs: Libraries; group: AvailableGroup }) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="sb-wb-lib-group">
      <button
        type="button"
        className="sb-wb-lib-group-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron size={14} />
        <span>{group.label}</span>
        <span className="sb-wb-lib-count">{group.libraries.length}</span>
      </button>
      {open && (
        <div className="sb-wb-lib-cards">
          {group.libraries.map((lib) => (
            <Card key={lib.uri} libs={libs} lib={lib} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ libs, lib }: { libs: Libraries; lib: InstallableLibrary }) {
  const key = installKey(lib.uri);
  const busy = libs.isBusy(key);
  const href = lib.website || lib.uri;
  return (
    <div className="sb-wb-lib-card">
      <div className="sb-wb-lib-card-head">
        {href ? (
          <a
            className="sb-wb-lib-card-title"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {lib.name}
          </a>
        ) : (
          <span className="sb-wb-lib-card-title">{lib.name}</span>
        )}
        {libs.writable && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void libs.install(lib.uri, key)}
          >
            <Busy busy={busy} busyLabel="Installing…">
              Install
            </Busy>
          </Button>
        )}
      </div>
      {lib.description && <Description text={lib.description} />}
    </div>
  );
}

function Description({ text }: { text: string }) {
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
      className="sb-wb-lib-card-desc"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
