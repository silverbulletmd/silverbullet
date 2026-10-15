import type {
  CatalogModel,
  SearchOverview,
  SpaceSearchInfo,
} from "@silverbulletmd/silverbullet/type/search_admin";
import type { RuntimeAvailability } from "./runtime_availability.ts";
import type {
  AuthenticationStatus,
  FieldError,
  GitStatus,
  GitDraft,
  ProfileInfo,
  UserInfo,
  SpaceInfo,
  VisibleSpace,
} from "./types.ts";

export async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const resp = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  // Only 401 — "no valid session" — means the browser should go log in.
  // A 403 is "signed in, but not permitted": it falls through to the normal
  // error path below so the caller renders a message. Redirecting on 403
  // would loop, since the login screen bounces a valid session straight back.
  if (resp.status === 401) throw { unauthorized: true };
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errors = json.errors ?? [
      {
        field: "",
        message: resp.status === 403 ? "Forbidden" : `HTTP ${resp.status}`,
      },
    ];
    if (resp.status === 404) errors.notFound = true;
    // A handful of routes (git sync) attach a structured `kind`/`message`
    // alongside the generic `errors` array, for callers that want to run
    // their own copy (e.g. `describeSyncError`) instead of the raw string.
    if (typeof json.kind === "string") errors.kind = json.kind;
    if (typeof json.message === "string") errors.detail = json.message;
    throw errors;
  }
  return json;
}

/**
 * Admin-only endpoints live under `api/admin/`. Split from `api()` so a
 * mistaken call to an admin route from a non-admin screen is visible at the
 * call site rather than buried in a path string.
 */
export function adminApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  return api(method, `api/admin/${path}`, body);
}

export function formatApiError(e: unknown): string {
  if (Array.isArray(e)) {
    return e
      .map((fe: FieldError) =>
        fe.field ? `${fe.field}: ${fe.message}` : fe.message,
      )
      .join(", ");
  }
  return "Request failed";
}

/** The message for a failed request; null after sending the user to sign in. */
export function apiErrorText(
  cause: unknown,
  onUnauthorized: () => void,
): string | null {
  if ((cause as { unauthorized?: boolean } | null)?.unauthorized) {
    onUnauthorized();
    return null;
  }
  return formatApiError(cause);
}

/** Server-level facts for admin screens. See `RuntimeAvailability`. */
export function getServerInfo(): Promise<{
  runtimeApi: RuntimeAvailability;
  runtimeApiEnabled: boolean;
  primaryUrl?: string | null;
  searchModel: Pick<CatalogModel, "id" | "displayName"> | null;
}> {
  return adminApi("GET", "server-info");
}

export function getSearchOverview(): Promise<SearchOverview> {
  return adminApi("GET", "search");
}

/** Chooses the search model (null: none); the download starts at once. */
export function setSearchModel(model: string | null): Promise<SearchOverview> {
  return adminApi("PUT", "search", { model });
}

/** Removes a stored model's files from the server. */
export async function removeSearchModel(id: string): Promise<void> {
  await adminApi("DELETE", `search/models/${encodeURIComponent(id)}`);
}

export function getSpaceSearch(id: string): Promise<SpaceSearchInfo> {
  return adminApi("GET", `spaces/${encodeURIComponent(id)}/search`);
}

export function rebuildSpaceSearch(id: string): Promise<SpaceSearchInfo> {
  return adminApi("POST", `spaces/${encodeURIComponent(id)}/search/rebuild`);
}

export async function listSpaceBindings(): Promise<VisibleSpace[]> {
  const spaces: Record<string, SpaceInfo> = await adminApi("GET", "spaces");
  return Object.entries(spaces).map(([id, space]) => ({
    id,
    name: space.name,
    binding: space.binding,
    access: space.access,
  }));
}

export function listUsers(): Promise<Record<string, UserInfo>> {
  return adminApi("GET", "users");
}

export function getUser(name: string): Promise<UserInfo> {
  return adminApi("GET", `users/${encodeURIComponent(name)}`);
}

export function getSession(): Promise<{ username: string; admin: boolean }> {
  return api("GET", "api/session");
}

export function createUser(
  username: string,
  password: string,
  admin: boolean,
  fullName: string,
  email: string,
  loginMethod: "local" | "sso" = "local",
  providerId = "",
  expectedEmail = "",
): Promise<void> {
  const profile = { username, admin, fullName, email, loginMethod };
  return adminApi(
    "POST",
    "users",
    loginMethod === "sso"
      ? { ...profile, providerId, expectedEmail }
      : { ...profile, password },
  );
}

export function getAuthenticationStatus(): Promise<AuthenticationStatus> {
  return adminApi("GET", "authentication");
}

export function deleteUser(name: string): Promise<void> {
  return adminApi("DELETE", `users/${encodeURIComponent(name)}`);
}

export function setUserPassword(name: string, password: string): Promise<void> {
  return adminApi("POST", `users/${encodeURIComponent(name)}/password`, {
    password,
  });
}

export function setUserAdmin(name: string, admin: boolean): Promise<void> {
  return adminApi("PUT", `users/${encodeURIComponent(name)}`, { admin });
}

export function setUserDisabled(
  name: string,
  disabled: boolean,
): Promise<void> {
  return adminApi("POST", `users/${encodeURIComponent(name)}/disabled`, {
    disabled,
  });
}

export function setUserProfile(
  name: string,
  fullName: string,
  email: string,
): Promise<void> {
  return adminApi("PUT", `users/${encodeURIComponent(name)}/profile`, {
    fullName,
    email,
  });
}

export function getProfile(): Promise<ProfileInfo> {
  return api("GET", "api/profile");
}

export function setProfile(fullName: string, email: string): Promise<void> {
  return api("PUT", "api/profile", { fullName, email });
}

export async function createToken(user: string, name: string): Promise<string> {
  const r = await adminApi("POST", `users/${encodeURIComponent(user)}/tokens`, {
    name,
  });
  return r.token;
}

export function signOutEverywhere(user: string): Promise<void> {
  return adminApi("DELETE", `users/${encodeURIComponent(user)}/sessions`);
}

export function deleteToken(user: string, name: string): Promise<void> {
  return adminApi(
    "DELETE",
    `users/${encodeURIComponent(user)}/tokens/${encodeURIComponent(name)}`,
  );
}

export function getGitStatus(spaceId: string): Promise<GitStatus> {
  return adminApi("GET", `spaces/${encodeURIComponent(spaceId)}/git`);
}

export function createGitDraft(spaceId: string): Promise<GitDraft> {
  return adminApi("POST", `spaces/${encodeURIComponent(spaceId)}/git/draft`);
}

export function updateGitDraft(
  spaceId: string,
  draft: GitDraft,
): Promise<GitDraft> {
  return adminApi(
    "PUT",
    `spaces/${encodeURIComponent(spaceId)}/git/draft/${encodeURIComponent(draft.id)}`,
    {
      version: draft.version,
      url: draft.url,
      mode: draft.mode,
      pullIntervalSecs: draft.pullIntervalSecs,
      remoteBranch: draft.remoteBranch,
      remoteBranchSelected: draft.remoteBranchSelected,
    },
  );
}

export function discardGitDraft(
  spaceId: string,
  draftId: string,
): Promise<void> {
  return adminApi(
    "DELETE",
    `spaces/${encodeURIComponent(spaceId)}/git/draft/${encodeURIComponent(draftId)}`,
  );
}

export function gitDraftAction(
  spaceId: string,
  draft: GitDraft,
  action: "key" | "test",
): Promise<GitDraft> {
  return adminApi(
    "POST",
    `spaces/${encodeURIComponent(spaceId)}/git/draft/${encodeURIComponent(draft.id)}/${action}`,
    { version: draft.version },
  );
}

export function applyGitDraft(
  spaceId: string,
  draft: GitDraft,
  allowUnrelated: boolean,
): Promise<void> {
  return adminApi(
    "POST",
    `spaces/${encodeURIComponent(spaceId)}/git/draft/${encodeURIComponent(draft.id)}/apply`,
    { version: draft.version, allowUnrelated },
  );
}

export function setGitPaused(spaceId: string, paused: boolean): Promise<void> {
  return adminApi(
    "POST",
    `spaces/${encodeURIComponent(spaceId)}/git/${paused ? "pause" : "resume"}`,
  );
}

export function disconnectGit(spaceId: string): Promise<void> {
  return adminApi(
    "DELETE",
    `spaces/${encodeURIComponent(spaceId)}/git/connection`,
  );
}

export function syncGitNow(spaceId: string): Promise<void> {
  return adminApi("POST", `spaces/${encodeURIComponent(spaceId)}/git/sync`, {});
}
