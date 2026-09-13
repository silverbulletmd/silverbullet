import { copyToClipboard } from "../../clipboard.ts";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Select,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { syncStatusText } from "../../sync_notification.ts";
import {
  adminApi,
  applyGitDraft,
  createGitDraft,
  discardGitDraft,
  disconnectGit,
  formatApiError,
  getGitStatus,
  gitDraftAction,
  setGitPaused,
  syncGitNow,
  updateGitDraft,
} from "../api.ts";
import { spaceUrl } from "../bindings.ts";
import { GitDraftSession } from "../git_draft.ts";
import { parseRepoUrl } from "../git_remote.ts";
import {
  describeSyncError,
  describeTestResult,
  formatDuration,
} from "../git_sync_copy.ts";
import { setNavigationGuard } from "../navigation.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import { spacesUrl } from "../routes.ts";
import type { GitDraft, GitStatus, SpaceInfo } from "../types.ts";

const FREQUENCIES = [
  [60, "Every minute"],
  [300, "Every 5 minutes"],
  [3600, "Hourly"],
  [0, "Only when this space changes"],
] as const;

export function GitSyncPage({
  spaceId,
  onUnauthorized,
  spaceInfo,
  onDraftChange,
}: {
  spaceId: string;
  spaceInfo?: SpaceInfo;
  onDraftChange?: (open: boolean, changed: boolean) => void;
  onUnauthorized: () => void;
}) {
  const [fetchedSpace, setSpace] = useState<SpaceInfo>();
  const space = spaceInfo ?? fetchedSpace;
  const embedded = !!spaceInfo;
  const Subheading = embedded ? "h4" : "h2";
  const [status, setStatus] = useState<GitStatus>();
  const [statusError, setStatusError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [session, setSession] = useState<GitDraftSession>();
  const [, render] = useState(0);
  const [repository, setRepository] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [combine, setCombine] = useState(false);
  const [copy, setCopy] = useState("");
  const [generatedDraftKey, setGeneratedDraftKey] = useState(false);
  const [notice, setNotice] = useState("");
  const notify = useNotification("git");
  const request = useRef(0);
  const mounted = useRef(true);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connected = status ? status.credentialMode !== "off" : false;
  const draft = session?.value;
  const settingsUrl = spacesUrl(
    `/${encodeURIComponent(spaceId)}?section=revisions`,
  );

  const fail = (cause: any) => {
    if (cause?.kind === "staleDraft") {
      session?.invalidateCheck();
      render((n) => n + 1);
    }
    if (cause?.unauthorized) onUnauthorized();
    else
      setError(
        cause?.kind === "staleDraft"
          ? "The connection or revision history changed since this check. Check the connection again; if settings were changed elsewhere, cancel and reopen."
          : formatApiError(cause),
      );
  };
  const refresh = async () => {
    const sequence = ++request.current;
    try {
      const next = await getGitStatus(spaceId);
      if (!mounted.current || sequence !== request.current) return;
      setStatus(next);
      setStatusError("");
    } catch (cause: any) {
      if (!mounted.current || sequence !== request.current) return;
      if (cause?.unauthorized) onUnauthorized();
      else
        setStatusError(
          "Status unavailable. The last successful check below may be out of date.",
        );
    }
  };
  useEffect(() => {
    mounted.current = true;
    void adminApi("GET", `spaces/${encodeURIComponent(spaceId)}`)
      .then(setSpace)
      .catch(fail);
    void refresh();
    const visibleRefresh = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = setInterval(visibleRefresh, 5000);
    document.addEventListener("visibilitychange", visibleRefresh);
    window.addEventListener("focus", visibleRefresh);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibleRefresh);
      window.removeEventListener("focus", visibleRefresh);
      const pending = sessionRef.current;
      if (pending) {
        pending.discard();
        void discardGitDraft(spaceId, pending.value.id).catch(() => {});
      }
    };
  }, [spaceId]);
  useEffect(() => {
    onDraftChange?.(!!session, session?.changed ?? false);
  }, [!!session, session?.changed, onDraftChange]);
  useEffect(() => {
    if (!session?.changed || embedded) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const release = setNavigationGuard(() =>
      window.confirm(
        "Discard this connection draft and leave? The active connection will stay unchanged.",
      ),
    );
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      release();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [session?.changed, embedded]);

  const operation = async (name: string, run: () => Promise<void>) => {
    if (busy) return;
    setBusy(name);
    notify("");
    setError("");
    setNotice("");
    try {
      await run();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  };
  const edit = (fields: Parameters<GitDraftSession["edit"]>[0]) => {
    session!.edit(fields);
    setCombine(false);
    setError("");
    render((n) => n + 1);
  };
  const effectiveUrl = (value: string, mode = draft?.mode) => {
    if (mode === "key" && /^https?:\/\//i.test(value.trim()))
      return parseRepoUrl(value)?.sshUrl ?? value.trim();
    return value.trim();
  };
  const saveDraft = async () => {
    if (!session) return false;
    if (!session.dirty) return true;
    const current = await session.run((value) =>
      updateGitDraft(spaceId, value),
    );
    render((n) => n + 1);
    return current;
  };
  const draftOperation = (action: "key" | "test") =>
    operation(action, async () => {
      if (!(await saveDraft())) return;
      await session!.run((value) => gitDraftAction(spaceId, value, action));
      if (action === "key") {
        setGeneratedDraftKey(true);
        setCopy("");
      }
      render((n) => n + 1);
    });
  const cancel = () =>
    operation("cancel", async () => {
      await discardGitDraft(spaceId, draft!.id);
      session!.discard();
      sessionRef.current = undefined;
      setSession(undefined);
      notify("Draft discarded.");
      if (generatedDraftKey) {
        setNotice(
          "If you added its public key to the repository, remove that unused key there.",
        );
      }
      await refresh();
    });
  const test = draft?.test;
  const provider = draft ? parseRepoUrl(draft.url) : null;
  const syncText =
    status &&
    syncStatusText({
      sync: status.sync,
      enabled: status.enabled ?? connected,
      paused: status.paused ?? false,
      lastSuccess: status.lastSuccess ?? null,
      lastAttempt: status.lastAttempt ?? null,
      version: status.version ?? 0,
      pending: status.ahead,
      incoming: status.behind,
      dirty: status.dirty,
    });

  return (
    <section class="sb-git-page">
      {!embedded && (
        <p>
          <a href={settingsUrl}>Space settings</a> ·{" "}
          <a href={spacesUrl("/")}>All spaces</a>
        </p>
      )}
      {embedded ? (
        <h3>Git sync</h3>
      ) : (
        <h1>Git sync{space ? ` · ${space.name}` : ""}</h1>
      )}
      <SaveConfirmation scope="git" />
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="info">{notice}</Alert>}
      {space && space.revisions !== "managed" ? (
        <Alert variant="info">
          {embedded ? (
            <>Choose Managed above and save to connect a Git repository.</>
          ) : (
            <>
              Git sync requires automatic revisions.{" "}
              <a href={settingsUrl}>Set revisions to Managed</a> and save to
              connect a repository.
            </>
          )}
        </Alert>
      ) : (
        <>
          {statusError && (
            <Alert variant="warning">
              {statusError}{" "}
              <Button onClick={() => void refresh()}>Retry status</Button>
            </Alert>
          )}
          {!session ? (
            <>
              {!status && !statusError && <p>Loading connection…</p>}
              {status && (
                <>
                  <Subheading>
                    {connected ? status.remoteUrl : "Connect a Git repository"}
                  </Subheading>
                  <p role="status" aria-label="Git sync status">
                    {statusError ? "Status unavailable" : syncText}
                  </p>
                  {connected && (
                    <>
                      <dl>
                        <dt>Branch</dt>
                        <dd>{status.branch ?? "Not known yet"}</dd>
                        <dt>Authentication</dt>
                        <dd>
                          {status.credentialMode === "key"
                            ? "Deploy key for this space"
                            : "Use server credentials"}
                        </dd>
                        <dt>Last successful sync</dt>
                        <dd>
                          {status.lastSuccess
                            ? new Date(status.lastSuccess).toLocaleString()
                            : "No successful sync recorded since server start"}
                        </dd>
                        <dt>Last attempt</dt>
                        <dd>
                          {status.lastAttempt
                            ? new Date(status.lastAttempt).toLocaleString()
                            : "Not attempted yet"}
                        </dd>
                        <dt>Outgoing / incoming commits</dt>
                        <dd>
                          {status.ahead ?? "Unknown"} /{" "}
                          {status.behind ?? "Unknown"}
                        </dd>
                      </dl>
                      <p>
                        Local changes are pushed after an automatic commit.
                        Remote changes are checked{" "}
                        {status.pullIntervalSecs === 0
                          ? "when this space changes"
                          : `every ${formatDuration(status.pullIntervalSecs ?? 300)}`}
                        .
                      </p>
                      {!embedded && (
                        <p>
                          <a href={settingsUrl}>
                            Change automatic commit frequency in revisions
                            settings
                          </a>
                        </p>
                      )}
                      {status.sync.state === "error" && (
                        <Alert variant="warning">
                          {describeSyncError(
                            status.sync.kind,
                            status.sync.message ?? "",
                          )}
                        </Alert>
                      )}
                      {status.sync.state === "conflicted" && (
                        <Alert variant="warning">
                          Open this space and choose Git: Review conflicts to
                          resolve all {status.sync.paths.length} files. Editing
                          text markers away resumes sync automatically.
                          {space?.binding && (
                            <p>
                              <a
                                class="sb-button"
                                href={`${spaceUrl(space.binding)}?gitConflicts=1`}
                              >
                                Review conflicts
                              </a>
                            </p>
                          )}
                        </Alert>
                      )}
                    </>
                  )}
                  <div class="row">
                    {connected && (
                      <Button
                        disabled={
                          !!busy ||
                          status.paused ||
                          status.sync.state === "syncing"
                        }
                        onClick={() =>
                          void operation("sync", async () => {
                            await syncGitNow(spaceId);
                            await refresh();
                          })
                        }
                      >
                        {busy === "sync" ? "Requesting sync…" : "Sync now"}
                      </Button>
                    )}
                    {connected && (
                      <Button
                        disabled={!!busy}
                        onClick={() =>
                          void operation("pause", async () => {
                            await setGitPaused(spaceId, !status.paused);
                            notify(
                              status.paused ? "Sync resumed." : "Sync paused.",
                            );
                            await refresh();
                          })
                        }
                      >
                        {status.paused ? "Resume sync" : "Pause sync"}
                      </Button>
                    )}
                    <Button
                      disabled={!!busy}
                      variant="primary"
                      onClick={() =>
                        void operation("draft", async () => {
                          const value = await createGitDraft(spaceId);
                          setSession(new GitDraftSession(value));
                          setRepository(value.url);
                          setGeneratedDraftKey(false);
                          setAdvanced(false);
                          setCombine(false);
                          setNotice("");
                        })
                      }
                    >
                      {connected ? "Edit connection" : "Connect repository"}
                    </Button>
                    {connected && (
                      <Button
                        variant="danger"
                        disabled={!!busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Remove this connection and stop syncing? Your files and revision history will be kept. If you added a deploy key at the Git provider, remove it there separately.",
                            )
                          )
                            void operation("disconnect", async () => {
                              await disconnectGit(spaceId);
                              notify("Connection removed.");
                              await refresh();
                            });
                        }}
                      >
                        Remove connection
                      </Button>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            draft && (
              <>
                <Subheading>Repository</Subheading>
                <label for="git-repository">Repository</label>
                <Input
                  id="git-repository"
                  value={repository}
                  disabled={advanced || busy === "apply"}
                  placeholder="https://github.com/example/notes"
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setRepository(value);
                    edit({ url: effectiveUrl(value) });
                  }}
                />
                <p class="sb-help-text">
                  Paste a repository page URL or an SSH URL.
                </p>
                <p>
                  Destination: <code>{draft.url || "Enter a repository"}</code>
                </p>
                <details>
                  <summary>Advanced connection address</summary>
                  <label>
                    <Checkbox
                      disabled={busy === "apply"}
                      checked={advanced}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        setAdvanced(enabled);
                        edit({
                          url: enabled ? draft.url : effectiveUrl(repository),
                        });
                      }}
                    />{" "}
                    Use an exact connection URL
                  </label>
                  {advanced && (
                    <>
                      <label for="git-exact-url">Exact connection URL</label>
                      <Input
                        disabled={busy === "apply"}
                        id="git-exact-url"
                        value={draft.url}
                        onInput={(event) =>
                          edit({ url: event.currentTarget.value })
                        }
                      />
                      <p class="sb-help-text">
                        This overrides the repository field. Include any custom
                        SSH username or port here.
                      </p>
                    </>
                  )}
                </details>
                <p>
                  Branch: {draft.branch ?? "Not known yet"}
                  {draft.remoteBranch ? ` → ${draft.remoteBranch}` : ""}
                </p>
                <Subheading>Authentication</Subheading>
                <label for="git-authentication">Authentication</label>
                <Select
                  disabled={busy === "apply"}
                  id="git-authentication"
                  value={draft.mode}
                  onChange={(event) => {
                    const mode = event.currentTarget.value as GitDraft["mode"];
                    edit({
                      mode,
                      ...(!advanced
                        ? { url: effectiveUrl(repository, mode) }
                        : {}),
                    });
                  }}
                >
                  <option value="key">Deploy key for this space</option>
                  <option value="manual">Use server credentials</option>
                </Select>
                {draft.mode === "key" ? (
                  <>
                    <p class="sb-help-text">
                      SilverBullet uses only this space's key. Add its public
                      key to the repository with write access.
                    </p>
                    {draft.publicKey ? (
                      <>
                        <label for="git-public-key">Public key</label>
                        <textarea
                          id="git-public-key"
                          readOnly
                          value={draft.publicKey}
                          rows={3}
                        />
                        <div class="row">
                          <Button
                            onClick={async () => {
                              try {
                                await copyToClipboard(draft.publicKey!);
                                setCopy("Public key copied");
                              } catch {
                                setCopy(
                                  "Could not copy. Select and copy the public key above.",
                                );
                              }
                            }}
                          >
                            Copy public key
                          </Button>
                          <Button
                            disabled={!!busy}
                            onClick={() => void draftOperation("key")}
                          >
                            Generate a replacement draft key
                          </Button>
                        </div>
                        <p role="status">{copy}</p>
                        <p class="sb-help-text">
                          Fingerprint: {draft.fingerprint ?? "Unavailable"}
                        </p>
                        {provider?.deployKeyUrl && (
                          <p>
                            <a
                              href={provider.deployKeyUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Add key to repository with write access
                            </a>
                          </p>
                        )}
                      </>
                    ) : (
                      <Button
                        disabled={!!busy || !draft.url.trim()}
                        onClick={() => void draftOperation("key")}
                      >
                        {busy === "key" ? "Generating…" : "Generate deploy key"}
                      </Button>
                    )}
                  </>
                ) : (
                  <Alert variant="info">
                    Uses the server's existing Git credentials and
                    configuration. Sync still runs automatically. This advanced
                    option requires credentials to be set up on the server.
                  </Alert>
                )}
                <Subheading>Check and enable</Subheading>
                <label for="git-pull-frequency">Check remote changes</label>
                <Select
                  disabled={busy === "apply"}
                  id="git-pull-frequency"
                  value={String(draft.pullIntervalSecs)}
                  onChange={(event) =>
                    edit({
                      pullIntervalSecs: Number(event.currentTarget.value),
                    })
                  }
                >
                  {FREQUENCIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  {!FREQUENCIES.some(
                    ([value]) => value === draft.pullIntervalSecs,
                  ) && (
                    <option value={draft.pullIntervalSecs}>
                      Every {formatDuration(draft.pullIntervalSecs)}
                    </option>
                  )}
                </Select>
                {draft.pullIntervalSecs === 0 && (
                  <p class="sb-help-text">
                    No periodic remote checks. Each sync after a local commit
                    still fetches and merges before pushing.
                  </p>
                )}

                {test && (
                  <section class="sb-git-check" aria-label="Connection check">
                    <Alert
                      variant={
                        test.reachable && test.writable ? "info" : "warning"
                      }
                    >
                      {test.reachable && test.writable
                        ? "Repository reachable. Push preflight passed. The first sync will confirm whether repository rules permit a real push."
                        : describeTestResult(test.kind, test.message).text}
                    </Alert>
                    <p>
                      Checked <code>{test.checkedUrl}</code> using{" "}
                      {draft.mode === "key"
                        ? `deploy key ${draft.fingerprint ?? ""}`
                        : "server credentials"}{" "}
                      at {new Date(test.checkedAt).toLocaleString()}.
                    </p>
                    <p>
                      Branch: {test.branch ?? "Not known yet"}
                      {test.remoteBranch ? ` → ${test.remoteBranch}` : ""}.
                      Outgoing commits: {test.ahead ?? "Unknown"}. Incoming
                      commits: {test.behind ?? "Unknown"}.
                    </p>
                    <p>
                      This shares this space's committed history, including
                      previous page contents.
                    </p>
                    {test.unrelated && (
                      <Alert variant="warning">
                        <p>
                          These histories are unrelated. Combining them keeps
                          both histories and may produce page conflicts.
                        </p>
                        <label>
                          <Checkbox
                            checked={combine}
                            onChange={(event) =>
                              setCombine(event.currentTarget.checked)
                            }
                          />{" "}
                          Combine these histories
                        </label>
                      </Alert>
                    )}
                  </section>
                )}
                <div class="row">
                  <Button
                    disabled={
                      !!busy ||
                      !draft.url.trim() ||
                      (draft.mode === "key" && !draft.publicKey)
                    }
                    onClick={() => void draftOperation("test")}
                  >
                    {busy === "test" ? "Checking…" : "Check connection"}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={
                      !!busy ||
                      !session.canApply ||
                      (connected && !session.changed) ||
                      (!!test?.unrelated && !combine)
                    }
                    onClick={() =>
                      void operation("apply", async () => {
                        await applyGitDraft(spaceId, draft, combine);
                        session.discard();
                        sessionRef.current = undefined;
                        setSession(undefined);
                        notify(
                          "Connection applied. Sync is queued; its result will appear below.",
                        );
                        await refresh();
                      })
                    }
                  >
                    {busy === "apply"
                      ? "Applying…"
                      : connected
                        ? "Apply changes"
                        : "Enable sync"}
                  </Button>
                  <Button disabled={!!busy} onClick={() => void cancel()}>
                    Cancel
                  </Button>
                </div>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
