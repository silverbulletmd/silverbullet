import type { FieldError, UserInfo } from "./types.ts";

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

// --- User management (backed by users.json via the admin API) ------------

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
): Promise<void> {
  return adminApi("POST", "users", { username, password, admin });
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

export async function createToken(user: string, name: string): Promise<string> {
  const r = await adminApi("POST", `users/${encodeURIComponent(user)}/tokens`, {
    name,
  });
  return r.token;
}

export function deleteToken(user: string, name: string): Promise<void> {
  return adminApi(
    "DELETE",
    `users/${encodeURIComponent(user)}/tokens/${encodeURIComponent(name)}`,
  );
}
