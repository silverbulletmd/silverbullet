import type { GitSyncMode, GitTestKind } from "./types.ts";

export type GitSyncModeOption = {
  value: GitSyncMode;
  label: string;
  description: string;
};

/**
 * The three modes, in the order the select offers them. `manual` is named
 * for what it actually does — hand git the credentials the server already
 * has — rather than for the implementation word "ambient", which tells an
 * admin nothing about whose keys are about to be used.
 */
export const GIT_SYNC_MODES: GitSyncModeOption[] = [
  {
    value: "off",
    label: "Off",
    description:
      "Nothing is pushed or pulled. The space's history stays on this server.",
  },
  {
    value: "key",
    label: "SSH key managed by SilverBullet",
    description:
      "SilverBullet generates a deploy key for this space and uses only that key. Add its public half to the repository, with write access.",
  },
  {
    value: "manual",
    label: "Manual — use the server's own git credentials",
    description:
      "You manage credentials yourself: the server user's ~/.ssh, a credential helper, or a repository you already cloned there. SilverBullet supplies no key of its own.",
  },
];

/** Falls back to Off for a mode a newer server invented, so an unfamiliar
 * value renders as the safe one rather than as an empty select. */
export function describeGitSyncMode(mode: GitSyncMode): GitSyncModeOption {
  return GIT_SYNC_MODES.find((m) => m.value === mode) ?? GIT_SYNC_MODES[0];
}

/** `45s`, `10min` — used by both the Commit-frequency and Pull-frequency
 * "Custom (…)" fallback options when a stored value matches no preset. */
export function formatDuration(secs: number): string {
  return secs >= 60 && secs % 60 === 0 ? `${secs / 60}min` : `${secs}s`;
}

export type TestResultRender = {
  variant: "ok" | "info" | "warning" | "error";
  text: string;
};

/**
 * Human copy for every `GitTestResult.kind` the server can send (see
 * `classify_git_test_error` in `admin_api.rs`), typed against the server's
 * literal union, with its own test rather than inline in the component.
 */
export function describeTestResult(
  kind: GitTestKind,
  message: string,
): TestResultRender {
  switch (kind) {
    case "ok":
      return { variant: "ok", text: "Reachable and writable." };
    // A repo with no commits yet genuinely cannot prove write access — this
    // is the normal first-run path, not a failure.
    case "emptyRepo":
      return { variant: "info", text: message };
    case "behind":
      return {
        variant: "warning",
        text: "The remote has commits this space doesn't have yet — sync will pull them first before it can push.",
      };
    case "authFailed":
      return {
        variant: "error",
        text: `Connected, but the credentials don't have write access.${
          message ? ` ${message}` : ""
        }`,
      };
    // A managed key is an SSH key and `GIT_SSH_COMMAND` is inert over HTTPS,
    // so this is a transport mismatch rather than anything to do with access.
    case "sshRequired":
      return {
        variant: "error",
        text: "A deploy key only works over SSH. Use an SSH connection URL or choose Use server credentials for an HTTPS repository.",
      };
    // `notFound` is genuinely ambiguous: GitHub and GitLab both answer an
    // `ls-remote` against a private repo the caller can't see with the exact
    // same "not found" error as a URL that's simply wrong — so the copy
    // names both possibilities rather than asserting the wrong one. It says
    // "credentials" rather than "key" because it is rendered verbatim in
    // manual mode too, where there is no key.
    case "notFound":
      return {
        variant: "error",
        text: `Repository not found — or it's private and the credentials in use don't have access. A wrong URL and missing access look identical from outside.${
          message ? ` ${message}` : ""
        }`,
      };
    case "unreachable":
      return {
        variant: "error",
        text: `Could not reach the remote host.${message ? ` ${message}` : ""}`,
      };
    default:
      return {
        variant: "error",
        text: message || "The connection test failed.",
      };
  }
}

const SYNC_ERROR_COPY: Record<string, string> = {
  HostUnreachable: "Could not reach the remote host.",
  AuthFailed: "The credentials don't have access to the remote.",
  NoRemote: "No git remote is configured for this space yet.",
  PushRejected:
    "The push was rejected — the remote has changes this space doesn't have yet.",
  UnrelatedHistories:
    "The remote already contains history unrelated to this space.",
};

const GENERIC_SYNC_ERROR = "Sync failed — check the space's git settings.";

/** Copy for `GitStatus.sync` when `state === "error"`. `kind` there is the
 * server's `SyncError` Debug name (see `revisions/sync.rs`), a much looser
 * contract than `GitTestKind` — new variants are meant to fall back to the
 * generic line rather than break, so `kind` stays untyped here. */
export function describeSyncError(kind: string, message: string): string {
  const base = SYNC_ERROR_COPY[kind] ?? GENERIC_SYNC_ERROR;
  return message && message !== kind ? `${base} (${message})` : base;
}

/**
 * Whether a first-sync confirmation is warranted for this `ahead` count.
 * `null` (genuinely unknown — no `FETCH_HEAD`/tracking ref yet) and `0`
 * (nothing to push) both pass through silently; only a real, known,
 * positive count blocks. A type predicate so callers get `ahead` narrowed
 * to `number` for free rather than re-deriving it (or worse, trusting a
 * stale cached value the caller forgot to re-check).
 */
export function needsFirstSyncConfirm(ahead: number | null): ahead is number {
  return typeof ahead === "number" && ahead > 0;
}

/**
 * The `confirm()` prompt shown when an admin saves a space whose sync mode
 * is not Off while unpushed local commits are sitting on the branch —
 * saving must not be the first time someone learns what is about to leave
 * it. `ahead` must be a real, non-null count greater than zero; pass it
 * through `needsFirstSyncConfirm` first to decide whether to call this at
 * all.
 */
export function describeFirstSyncConfirm(
  ahead: number,
  remoteName: string | null,
  branch: string | null,
): string {
  const commits = ahead === 1 ? "1 local commit" : `${ahead} local commits`;
  const target =
    remoteName && branch ? `${remoteName}/${branch}` : "the remote";
  return `${commits} will be pushed to ${target}. Continue?`;
}

/**
 * Whether this save is the off→on transition the confirmation guards. A
 * space that is already syncing pushes whatever is on its branch on the next
 * tick regardless of this save, so prompting there guards nothing and trains
 * people to click through it.
 */
export function isFirstSyncSave(
  savedMode: GitSyncMode | undefined,
  editedMode: GitSyncMode,
): boolean {
  return (savedMode ?? "off") === "off" && editedMode !== "off";
}

export const COULD_NOT_CHECK_FIRST_SYNC =
  "Couldn't check whether this space has unpushed commits. Save anyway?";

export type FirstSyncPrompt =
  | { kind: "none" }
  | { kind: "count"; message: string }
  | { kind: "unknown"; message: string };

/**
 * The single entry point the form's save handler calls: takes whatever
 * `GitStatus` it has right before saving (freshly re-fetched, or — only on
 * a failed re-fetch — the last known one) and decides once, rather than the
 * caller growing its own second inline branch. `status
 * === null` means no read succeeded at all (the fresh fetch failed *and*
 * there was no earlier successful load to fall back to) — that is
 * genuinely different from a successful read whose `ahead` happens to be
 * `null` (a real repo state: no `FETCH_HEAD`/tracking ref yet). Only the
 * former gets the "couldn't check" prompt; the latter stays silent, same
 * as a known zero, because a modal about "an unknown number of commits" on
 * a repo that has always been fine would be worse than saying nothing.
 */
export function firstSyncPrompt(
  status: {
    ahead: number | null;
    remoteName: string | null;
    branch: string | null;
  } | null,
): FirstSyncPrompt {
  if (status === null) {
    return { kind: "unknown", message: COULD_NOT_CHECK_FIRST_SYNC };
  }
  const { ahead, remoteName, branch } = status;
  if (needsFirstSyncConfirm(ahead)) {
    return {
      kind: "count",
      message: describeFirstSyncConfirm(ahead, remoteName, branch),
    };
  }
  return { kind: "none" };
}
