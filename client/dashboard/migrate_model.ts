/**
 * The migration page's data: the JSON shapes of the `.setup/migrate/` API
 * (mirroring `server/src/multi/migrate/`) and the pure decisions the page
 * makes from them.
 */
import type { FieldError, RevisionsMode, SpaceAccess } from "./types.ts";

/** The sign-in page: almost always seen by the person who runs the server. */
export const GATE_HEADING = "Upgrade this SilverBullet server";
export const GATE_INTRO_CREDENTIALS =
  "SilverBullet now runs every server as a multi-space server, and this folder still uses the old single-space layout. Sign in with the username and password from SB_USER to review the upgrade. Nothing changes until you confirm.";
export const GATE_INTRO_CODE =
  "SilverBullet now runs every server as a multi-space server, and this folder still uses the old single-space layout. Enter the setup code printed in the server log to review the upgrade. Nothing changes until you confirm.";
export const GATE_VISITOR_NOTE =
  "Not running this server? It will be back once its owner finishes the upgrade.";
export const INTERRUPTED_NOTICE = "A migration was interrupted";
export const URL_WARNING =
  "Devices will need to sign in and download the space again. Edits made offline and not yet synced will not carry over.";
export const BACKUP_LABEL = "I have a backup of this folder";

export type Visitors = "none" | "read" | "write";

/** `plan.rs` `AdminChoice`: what the form submits. */
export type AdminChoice =
  | { kind: "create"; username: string }
  | { kind: "createNew"; username: string; password?: string }
  | { kind: "noAccounts" };

/** `plan.rs` `PlanEdits`. */
export type PlanEdits = {
  name: string;
  prefix: string;
  folder: string;
  visitors: Visitors;
  admin: AdminChoice;
};

/** `plan.rs` `AdminPlan`: the admin the plan creates, without a password. */
export type AdminPlan =
  | { kind: "fromEnv"; username: string }
  | { kind: "new"; username: string }
  | { kind: "noAccounts" };

export type Move = { from: string; to: string };

/** `blockers.rs` `Blocker`. */
export type Blocker =
  | { kind: "collision"; name: string }
  | { kind: "mount"; path: string }
  | { kind: "unsupportedName"; name: string }
  | { kind: "notWritable" };

/** The part of `config.rs` `SpaceConfig` the page shows. */
export type MigratedSpace = {
  name: string;
  folder: string;
  binding: { prefix: string };
  access?: SpaceAccess;
  readOnly: boolean;
  shell: { enabled: boolean; whitelist: string[] };
  indexPage: string;
  description: string;
  themeColor: string;
  headHtml: string;
  spaceIgnore: string;
  logPush: boolean;
  revisions: RevisionsMode;
  clientIdentityPath?: string;
  formerPrefixes?: string[];
};

/** `plan.rs` `MigrationPlan`. */
export type MigrationPlan = {
  moves: Move[];
  spaceId: string;
  space: MigratedSpace;
  admin: AdminPlan;
  apiToken: boolean;
  searchModel: string | null;
  /** `false` when `SB_RUNTIME_API` turned the Runtime API off. */
  runtimeApi: boolean;
  /** `SB_RUNTIME_IDLE_TIMEOUT`, in minutes. */
  runtimeIdleTimeout: number | null;
  envToRemove: string[];
  urlChanged: boolean;
  blockers: Blocker[];
};

/** `report.rs` `MigrationReport`: what `api/run` answers on success. */
export type MigrationReport = {
  moved: Move[];
  envToRemove: string[];
  prefixNote: boolean;
  /** The space's URL path, `/` for the root. */
  spacePrefix: string;
};

export type Gate = "credentials" | "code";

/** `api/status`. Anonymous callers get only the first three keys. */
export type MigrateStatus = {
  gate: Gate;
  signedIn: boolean;
  interrupted: boolean;
  defaults?: PlanEdits;
  /** The interrupted migration's plan, from its journal. */
  pendingPlan?: MigrationPlan;
  /** The journal exists but can't be read. */
  error?: string;
  /** Why the last run failed, until one succeeds. */
  lastError?: string;
  /** A run is moving files, or has finished and the server is switching to multi-space. */
  running?: boolean;
  /** What the last successful run did, while this server still answers. */
  report?: MigrationReport;
};

/** The plan form's state; `toRequest` turns it into `PlanEdits`. */
export type MigrateForm = {
  name: string;
  prefix: string;
  folder: string;
  visitors: Visitors;
  /** keep = the `SB_USER` account, new = a new account, none = no accounts. */
  adminMode: "keep" | "new" | "none";
  adminUsername: string;
  adminPassword: string;
};

export type GateField = {
  name: "username" | "password" | "code";
  label: string;
  type: "text" | "password";
  autocomplete: string;
};

export type View =
  | {
      kind: "gate";
      heading: string;
      intro: string;
      note: string;
      fields: GateField[];
    }
  | { kind: "running" }
  | { kind: "switchFailed"; report: MigrationReport; error: string | null }
  | { kind: "swapped"; report: MigrationReport }
  | { kind: "plan"; defaults: PlanEdits }
  | {
      kind: "interrupted";
      notice: string;
      plan: MigrationPlan | null;
      error: string | null;
    };

/** Fields of the plan form that show their own errors. */
const FORM_FIELDS = [
  "name",
  "prefix",
  "folder",
  "visitors",
  "admin",
  "adminUsername",
  "adminPassword",
];

/**
 * `path` resolved against the page itself, so an install on `/wiki` talks to
 * `/wiki/.setup/migrate/api/...`: its proxy may forward nothing else.
 */
export function apiUrl(path: string, base: string): string {
  return new URL(path, base).href;
}

export function formFromDefaults(defaults: PlanEdits): MigrateForm {
  const admin = defaults.admin;
  return {
    name: defaults.name,
    prefix: defaults.prefix,
    folder: defaults.folder,
    visitors: defaults.visitors,
    adminMode:
      admin.kind === "create"
        ? "keep"
        : admin.kind === "createNew"
          ? "new"
          : "none",
    adminUsername: admin.kind === "noAccounts" ? "" : admin.username,
    adminPassword: "",
  };
}

export function toRequest(form: MigrateForm): PlanEdits {
  let admin: AdminChoice;
  switch (form.adminMode) {
    case "keep":
      admin = { kind: "create", username: form.adminUsername };
      break;
    case "new":
      admin = {
        kind: "createNew",
        username: form.adminUsername,
        password: form.adminPassword,
      };
      break;
    case "none":
      admin = { kind: "noAccounts" };
      break;
  }
  return {
    name: form.name,
    prefix: form.prefix,
    folder: form.folder,
    visitors: form.visitors,
    admin,
  };
}

export function urlWarning(plan: MigrationPlan): string | null {
  return plan.urlChanged ? URL_WARNING : null;
}

/** The form fields the user has edited or left, by `FORM_FIELDS` name. */
export type Touched = Partial<Record<string, boolean>>;

/** Which fields an edit of `patch` touches. */
export function touchedBy(patch: Partial<MigrateForm>): string[] {
  return Object.keys(patch).filter(
    (key) => key === "adminUsername" || key === "adminPassword",
  );
}

/**
 * The field errors to show. Every error shows, except the administrator's
 * username or password error while that field is still empty and was never
 * edited: a fresh form shouldn't open with red fields.
 */
export function visibleFieldErrors(
  byField: Record<string, string>,
  form: MigrateForm,
  touched: Touched,
): Record<string, string> {
  const visible: Record<string, string> = {};
  for (const [field, message] of Object.entries(byField)) {
    const pristine =
      (field === "adminUsername" && form.adminUsername === "") ||
      (field === "adminPassword" && form.adminPassword === "");
    if (!pristine || touched[field]) visible[field] = message;
  }
  return visible;
}

/** Whether the administrator's fields are too incomplete to run. */
export function adminIncomplete(form: MigrateForm): boolean {
  if (form.adminMode === "none") return false;
  if (form.adminUsername.trim() === "") return true;
  return form.adminMode === "new" && form.adminPassword === "";
}

/** `api/plan`'s answer: the plan, plus the errors that don't change it. */
export type PlanAnswer = { plan: MigrationPlan; errors: FieldError[] };

/**
 * Why Migrate is disabled, or null when it can run. `plan` is the plan for
 * the current edits, or null while it loads or when none could be built.
 */
export function migrateDisabledReason(state: {
  plan: MigrationPlan | null;
  errors: FieldError[];
  visibleErrors: number;
  form: MigrateForm;
  backupConfirmed: boolean;
}): string | null {
  if (state.visibleErrors > 0) return "Fix the errors above";
  if (adminIncomplete(state.form)) {
    return state.form.adminMode === "keep"
      ? "Choose an administrator username"
      : "Choose an administrator username and password";
  }
  if (state.errors.length > 0) return "Fix the errors above";
  if (state.plan === null) return "Waiting for the plan";
  if (state.plan.blockers.length > 0) return "Resolve the blockers";
  if (!state.backupConfirmed) return "Confirm you have a backup";
  return null;
}

/** `plan` is null while the form has errors or no plan has loaded yet. */
export function canMigrate(
  plan: MigrationPlan | null,
  backupConfirmed: boolean,
): boolean {
  return plan !== null && plan.blockers.length === 0 && backupConfirmed;
}

export function gateFields(status: MigrateStatus): GateField[] {
  if (status.gate === "credentials") {
    return [
      {
        name: "username",
        label: "Username",
        type: "text",
        autocomplete: "username",
      },
      {
        name: "password",
        label: "Password",
        type: "password",
        autocomplete: "current-password",
      },
    ];
  }
  return [
    {
      name: "code",
      label: "Setup code (printed in the server log)",
      type: "text",
      autocomplete: "one-time-code",
    },
  ];
}

/** Which screen `status` calls for. Anonymous callers learn nothing else. */
export function view(status: MigrateStatus): View {
  if (!status.signedIn) {
    return {
      kind: "gate",
      heading: GATE_HEADING,
      intro:
        status.gate === "credentials"
          ? GATE_INTRO_CREDENTIALS
          : GATE_INTRO_CODE,
      note: GATE_VISITOR_NOTE,
      fields: gateFields(status),
    };
  }
  // A running migration has a journal too; it isn't interrupted.
  if (status.running) return { kind: "running" };
  // A finished run's report outlives the run only if the swap failed, which
  // `lastError` says. Without it the swap has probably just happened.
  if (status.report && !status.lastError) {
    return { kind: "swapped", report: status.report };
  }
  if (status.report) {
    return {
      kind: "switchFailed",
      report: status.report,
      error: status.lastError ?? null,
    };
  }
  if (status.interrupted) {
    return {
      kind: "interrupted",
      notice: INTERRUPTED_NOTICE,
      plan: status.pendingPlan ?? null,
      error: status.error ?? status.lastError ?? null,
    };
  }
  // A signed-in status always carries defaults; the fallback only guards a
  // malformed answer.
  return {
    kind: "plan",
    defaults: status.defaults ?? {
      name: "",
      prefix: "/",
      folder: "",
      visitors: "none",
      admin: { kind: "noAccounts" },
    },
  };
}

/** Errors on a form field, keyed by field, and the rest. */
export function splitFieldErrors(errors: FieldError[]): {
  byField: Record<string, string>;
  other: FieldError[];
} {
  const byField: Record<string, string> = {};
  const other: FieldError[] = [];
  for (const error of errors) {
    if (FORM_FIELDS.includes(error.field)) {
      byField[error.field] = byField[error.field]
        ? `${byField[error.field]}; ${error.message}`
        : error.message;
    } else {
      other.push(error);
    }
  }
  return { byField, other };
}

/** A failed API answer's body (`{errors}` or `{error}`) as field errors. */
export function parseFailure(status: number, body: unknown): FieldError[] {
  const json = (body ?? {}) as { errors?: unknown; error?: unknown };
  if (Array.isArray(json.errors)) return json.errors as FieldError[];
  if (typeof json.error === "string")
    return [{ field: "", message: json.error }];
  return [{ field: "", message: `Request failed (HTTP ${status})` }];
}

/** The space's prefix as a path, `/` for the root (stored as empty). */
export function displayPrefix(plan: MigrationPlan): string {
  return plan.space.binding.prefix || "/";
}

/** The migrated space's address, from the run's report. */
export function reportSpaceUrl(
  report: MigrationReport,
  origin: string,
): string {
  return `${origin}${report.spacePrefix.replace(/\/+$/, "")}/`;
}

export function dashboardUrl(origin: string): string {
  return `${origin}/.dashboard/`;
}

/** The files the migration writes into the data root (`execute.rs`). */
export function filesWritten(plan: MigrationPlan): string[] {
  const files = ["spaces.json", "users.json", "MIGRATION.md"];
  if (
    plan.searchModel ||
    !plan.runtimeApi ||
    plan.runtimeIdleTimeout !== null
  ) {
    files.push("server.json");
  }
  return files;
}

/** The legacy settings the migrated space keeps, as label/value rows. */
export function carriedSettings(plan: MigrationPlan): Array<[string, string]> {
  const space = plan.space;
  const rows: Array<[string, string]> = [
    ["Index page", space.indexPage],
    ["Read-only", space.readOnly ? "yes" : "no"],
    ["Description", space.description || "(none)"],
    ["Theme colour", space.themeColor],
    ["Head HTML", space.headHtml ? "set" : "(none)"],
    ["Space ignore", space.spaceIgnore || "(none)"],
    ["Log push", space.logPush ? "on" : "off"],
    ["Revisions", space.revisions],
    [
      "Shell",
      !space.shell.enabled
        ? "off"
        : space.shell.whitelist.length > 0
          ? space.shell.whitelist.join(", ")
          : "on (no allowlist)",
    ],
  ];
  if (plan.apiToken) {
    rows.push([
      "API token",
      "SB_AUTH_TOKEN becomes the administrator's API token",
    ]);
  }
  if (plan.searchModel) rows.push(["Search model", plan.searchModel]);
  if (!plan.runtimeApi) rows.push(["Runtime API", "off"]);
  if (plan.runtimeIdleTimeout !== null) {
    rows.push([
      "Runtime idle timeout",
      idleTimeoutLabel(plan.runtimeIdleTimeout),
    ]);
  }
  return rows;
}

/** `report.rs` `idle_timeout_label`: `0` never stops a runtime. */
function idleTimeoutLabel(minutes: number): string {
  if (minutes === 0) return "never";
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function blockerMessage(blocker: Blocker): string {
  switch (blocker.kind) {
    case "collision":
      return `The folder already contains "${blocker.name}", which the multi-space layout needs. Move or rename it, then reload this page.`;
    case "mount":
      return `"${blocker.path}" is a separate mount (for example a Docker volume or bind mount), so it can't be moved by renaming. Move its contents into the folder and remove the mount, then reload this page.`;
    case "unsupportedName":
      return `"${blocker.name}" has a name that isn't valid UTF-8, which SilverBullet can't serve. Rename it, then reload this page.`;
    case "notWritable":
      return "The folder is not writable (for example a read-only mount). Give the server write access, then reload this page.";
  }
}

/** The text shown when `needsPrefixNote` holds (mirrors `MIGRATION.md`). */
export const PREFIX_NOTE =
  "The Dashboard and the server's own pages live at the root of this server (/.dashboard, /.instance, /.setup), not under the space's URL. If a reverse proxy forwards only the space's prefix to this server, it must also forward those paths for the Dashboard to be reachable.";

/** `report.rs` `needs_prefix_note`, for the plan preview. */
export function needsPrefixNote(plan: MigrationPlan): boolean {
  return (
    displayPrefix(plan) !== "/" ||
    (plan.space.formerPrefixes ?? []).some((prefix) => prefix !== "/")
  );
}

/** A move as paths relative to the data root (the parent of `from`). */
export function moveLabel(move: Move): Move {
  const cut = Math.max(move.from.lastIndexOf("/"), move.from.lastIndexOf("\\"));
  const root = move.from.slice(0, cut + 1);
  return {
    from: move.from.slice(cut + 1),
    to: move.to.startsWith(root) ? move.to.slice(root.length) : move.to,
  };
}

/**
 * Whether an `api/status` answer still comes from the migration router. After
 * the swap to multi-space nothing serves that path with a `gate`: it 404s,
 * redirects (status 0 with `redirect: "manual"`), refuses, or serves a page.
 */
export function stillMigrating(status: number, body: unknown): boolean {
  return (
    status === 200 &&
    typeof body === "object" &&
    body !== null &&
    "gate" in body
  );
}
