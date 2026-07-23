export type Binding =
  | { prefix: string; host?: never }
  | { host: string; prefix?: never };

export type FieldError = {
  field: string;
  message: string;
};

export type SpaceInfo = {
  name: string;
  folder: string;
  binding: Binding;
  // Access control: `public` spaces need no login at all; `members` lists
  // non-admin usernames granted access (admins always have access and are
  // never listed here).
  public: boolean;
  members: Record<string, object>;
  readOnly: boolean;
  shell: { enabled: boolean; whitelist: string[] };
  runtimeApi: boolean;
  indexPage: string;
  status: { state: "running" | "errored"; reason?: string };
};

/** GET /api/users entry: `{ "<username>": UserInfo }`. */
export interface UserInfo {
  admin: boolean;
  tokens: Record<string, { createdAt: string }>;
}

/**
 * What `GET api/spaces` returns to an ordinary account — an allowlist, not a
 * trimmed SpaceInfo. Admin screens use `SpaceInfo` from the admin API instead.
 */
export type VisibleSpace = {
  id: string;
  name: string;
  binding: Binding;
  state: "running" | "errored";
};

/** Where the Space Manager is in its session lifecycle. */
export type AuthState =
  | { phase: "loading" }
  | { phase: "login" }
  | { phase: "authed"; username: string; admin: boolean }
  | { phase: "error"; message: string };
