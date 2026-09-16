import type { GitSyncSnapshot } from "@silverbulletmd/silverbullet/type/revisions";
export type RevisionsMode = "managed" | "unmanaged" | "disabled";

export type SpaceAccess = "none" | "read" | "write";
export type MemberRole = "read" | "write";
export type MemberEntry = {
  role: MemberRole;
  runtimeApi?: boolean;
  [key: string]: unknown;
};

export type Binding =
  | { prefix: string; host?: never }
  | { host: string; prefix?: string };

export type FieldError = {
  field: string;
  message: string;
};

/** `off` syncs nothing; `key` uses a deploy key SilverBullet generates and
 * stores; `manual` uses whatever git credentials the server already has. */
export type GitSyncMode = "off" | "key" | "manual";

export type GitSyncConfig = {
  mode: GitSyncMode;
  pullIntervalSecs: number;
  paused?: boolean;
};

export type CommitTiming = { quietSecs: number; maxIntervalSecs: number };

/** `SyncState` on the server (`revisions::engine`) serializes with
 * `#[serde(tag = "state", rename_all = "camelCase")]`, which renames variant
 * names but not their fields — so `Paused`'s field stays `reason`, not
 * `message`. */
export type GitStatus = {
  remoteUrl: string | null;
  remoteName: string | null;
  branch: string | null;
  // The mode configured in `spaces.json`, not one derived from whether a key
  // file exists — the two can disagree, and the configured mode wins.
  credentialMode: GitSyncMode;
  publicKey: string | null;
  fingerprint: string | null;
  // `null` means genuinely unknown (no `FETCH_HEAD`/tracking ref yet), not
  // zero — the first-sync confirmation must not block on it.
  ahead: number | null;
  behind: number | null;
  sync: GitSyncSnapshot["sync"];
  lastAttempt?: number | null;
  lastSuccess?: number | null;
  version?: number;
  enabled?: boolean;
  paused?: boolean;
  pullIntervalSecs?: number;
  dirty?: boolean;
};

/** `POST spaces/{id}/git/test`. See `classify_git_test_error` on the server
 * for the exact classification these come from. */
export type GitTestKind =
  | "ok"
  | "emptyRepo"
  | "behind"
  | "authFailed"
  | "sshRequired"
  | "notFound"
  | "unreachable"
  | "other";

export type GitTestResult = {
  reachable: boolean;
  writable: boolean;
  kind: GitTestKind;
  message: string;
};

export type SpaceInfo = {
  name: string;
  folder: string;
  binding: Binding;
  bindingWarning?: string;
  // Access control: `access` is what a visitor with no session gets; `members`
  // grades individual accounts. Admins always have full access and are never
  // listed here. `readOnly` caps everyone, admins included.
  access: SpaceAccess;
  members: Record<string, MemberEntry>;
  readOnly: boolean;
  shell: { enabled: boolean; whitelist: string[] };
  revisions?: RevisionsMode;
  gitSync?: GitSyncConfig;
  revisionsCommit?: CommitTiming;
  indexPage: string;
  status: { state: "running" | "errored"; reason?: string };
};

/** GET /api/users entry: `{ "<username>": UserInfo }`. */
export interface UserInfo {
  admin: boolean;
  disabled: boolean;
  loginMethod: "local" | "sso";
  lastLogin?: string | null;
  fullName: string | null;
  email: string | null;
  sso: {
    providerId: string;
    expectedEmail: string;
    identity?: { issuer: string; subject: string };
  } | null;
  tokens: Record<string, { createdAt: string }>;
}

export interface AuthenticationStatus {
  enabled: boolean;
  active: {
    providerId: string;
    buttonLabel?: string;
  } | null;
  draft?: {
    providerId: string;
    buttonLabel?: string;
  } | null;
}

/** GET/PUT `api/profile`: the caller's own account. */
export interface ProfileInfo {
  username: string;
  admin: boolean;
  fullName: string | null;
  email: string | null;
}

/**
 * What `GET api/spaces` returns to an ordinary account — an allowlist, not a
 * trimmed SpaceInfo. Admin screens use `SpaceInfo` from the admin API instead.
 */
export type VisibleSpace = {
  id: string;
  name: string;
  binding: Binding;
  access: SpaceAccess;
};

/** Where the Dashboard is in its session lifecycle. */
export type AuthState =
  | { phase: "loading" }
  | { phase: "login" }
  | { phase: "authed"; username: string; admin: boolean }
  | { phase: "error"; message: string };

export type GitDraft = {
  branch?: string | null;
  remoteBranch?: string | null;
  remoteName?: string | null;
  id: string;
  version: number;
  url: string;
  mode: "key" | "manual";
  pullIntervalSecs: number;
  publicKey: string | null;
  fingerprint: string | null;
  test?: GitTestResult & {
    checkedUrl: string;
    checkedAt: number;
    branch?: string | null;
    remoteBranch?: string | null;
    localHead?: string | null;
    remoteHead?: string | null;
    ahead?: number | null;
    behind?: number | null;
    unrelated: boolean;
  };
};
