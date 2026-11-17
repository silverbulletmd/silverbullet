import {
  Alert,
  Button,
  ButtonLink,
  CheckboxField,
  Field,
  Input,
  PasswordInput,
  Select,
  UrlPrefixInput,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  apiUrl,
  BACKUP_LABEL,
  blockerMessage,
  canMigrate,
  carriedSettings,
  dashboardUrl,
  filesWritten,
  formFromDefaults,
  type GateField,
  type MigrateForm,
  type MigrateStatus,
  type MigrationPlan,
  type MigrationReport,
  type Move,
  moveLabel,
  migrateDisabledReason,
  needsPrefixNote,
  type PlanEdits,
  PREFIX_NOTE,
  parseFailure,
  reportSpaceUrl,
  splitFieldErrors,
  stillMigrating,
  type PlanAnswer,
  type Touched,
  touchedBy,
  toRequest,
  urlWarning,
  view,
  visibleFieldErrors,
} from "../../migrate_model.ts";
import { FieldErrors } from "../../space_fields.tsx";
import type { FieldError } from "../../types.ts";

/** How long the plan form waits after an edit before asking for a new plan. */
const PREVIEW_DELAY_MS = 300;

class ApiFailure {
  constructor(
    readonly status: number,
    readonly errors: FieldError[],
  ) {}
}

/** GET (no body) or JSON POST to the flow's API, relative to this page. */
async function call<T>(path: string, body?: unknown): Promise<T> {
  const post = body !== undefined;
  const resp = await fetch(apiUrl(path, document.baseURI), {
    method: post ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: post ? { "Content-Type": "application/json" } : {},
    body: post ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok)
    throw new ApiFailure(resp.status, parseFailure(resp.status, json));
  return json as T;
}

function failureErrors(e: unknown): FieldError[] {
  return e instanceof ApiFailure
    ? e.errors
    : [{ field: "", message: "The server could not be reached." }];
}

type Done = { report: MigrationReport };

/** Gate → plan (or finishing an interrupted run) → done. */
export function MigrateFlow() {
  const [status, setStatus] = useState<MigrateStatus | null>(null);
  const [loadError, setLoadError] = useState<FieldError[]>([]);
  const [done, setDone] = useState<Done | null>(null);

  async function load() {
    try {
      setStatus(await call<MigrateStatus>("api/status"));
      setLoadError([]);
    } catch (e) {
      setLoadError(failureErrors(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  /** A 401 mid-flow means the session is gone (the server restarted). */
  function onFailure(e: unknown): FieldError[] {
    if (e instanceof ApiFailure && e.status === 401) void load();
    return failureErrors(e);
  }

  /**
   * A failed run leaves an interrupted migration to show, and a proxy that
   * gave up on a long one (502, 504) leaves it still running.
   */
  function onRunFailure(e: unknown): FieldError[] {
    if (e instanceof ApiFailure && e.status >= 500) void load();
    return onFailure(e);
  }

  if (done) return <DonePage {...done} />;
  if (!status) {
    return loadError.length > 0 ? (
      <FieldErrors errors={loadError} />
    ) : (
      <p>Loading…</p>
    );
  }
  const current = view(status);
  switch (current.kind) {
    case "gate":
      return (
        <GatePage
          notice={current.notice}
          fields={current.fields}
          onSignedIn={() => void load()}
        />
      );
    case "running":
      return <RunningPage onStopped={() => void load()} onDone={setDone} />;
    case "swapped":
      // The run finished and the swap just happened: the done page waits for it.
      return <DonePage report={current.report} />;
    case "switchFailed":
      return <SwitchFailedPage report={current.report} error={current.error} />;
    case "interrupted":
      return (
        <InterruptedPage
          notice={current.notice}
          plan={current.plan}
          error={current.error}
          onRunFailure={onRunFailure}
          onDone={setDone}
        />
      );
    case "plan":
      return (
        <PlanPage
          defaults={current.defaults}
          onFailure={onFailure}
          onRunFailure={onRunFailure}
          onDone={setDone}
        />
      );
  }
}

function GatePage({
  notice,
  fields,
  onSignedIn,
}: {
  notice: string;
  fields: GateField[];
  onSignedIn: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await call("api/login", values);
      onSignedIn();
    } catch (e) {
      setErrors(failureErrors(e));
      setBusy(false);
    }
  }

  return (
    <form
      class="flow"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1>{notice}</h1>
      <FieldErrors errors={errors} />
      {fields.map((field) => (
        <Field label={field.label} key={field.name}>
          {field.type === "password" ? (
            <PasswordInput
              id={`migrate-${field.name}`}
              autocomplete={field.autocomplete}
              value={values[field.name] ?? ""}
              onInput={(e) =>
                setValues({ ...values, [field.name]: e.currentTarget.value })
              }
            />
          ) : (
            <Input
              id={`migrate-${field.name}`}
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              autocomplete={field.autocomplete}
              value={values[field.name] ?? ""}
              onInput={(e) =>
                setValues({ ...values, [field.name]: e.currentTarget.value })
              }
            />
          )}
        </Field>
      ))}
      <div class="row">
        <Button type="submit" variant="primary" disabled={busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function PlanPage({
  defaults,
  onFailure,
  onRunFailure,
  onDone,
}: {
  defaults: PlanEdits;
  onFailure: (e: unknown) => FieldError[];
  onRunFailure: (e: unknown) => FieldError[];
  onDone: (done: Done) => void;
}) {
  const [form, setForm] = useState<MigrateForm>(() =>
    formFromDefaults(defaults),
  );
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [previewing, setPreviewing] = useState(true);
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runErrors, setRunErrors] = useState<FieldError[]>([]);
  const [touched, setTouched] = useState<Touched>({});
  // Only the answer to the latest edit is shown; earlier ones are stale.
  const latest = useRef(0);

  useEffect(() => {
    const seq = ++latest.current;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const next = await call<PlanAnswer>("api/plan", toRequest(form));
        if (seq !== latest.current) return;
        setPlan(next.plan);
        setErrors(next.errors);
      } catch (e) {
        if (seq !== latest.current) return;
        // No plan for these edits, and the previous one isn't for them.
        setPlan(null);
        setErrors(onFailure(e));
      }
      setPreviewing(false);
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form]);

  function touch(...fields: string[]) {
    setTouched((t) => ({
      ...t,
      ...Object.fromEntries(fields.map((f) => [f, true])),
    }));
  }

  function edit(patch: Partial<MigrateForm>) {
    setForm({ ...form, ...patch });
    touch(...touchedBy(patch));
    // Set here, not only in the effect, so Migrate is never enabled for a
    // frame against the previous edits' plan.
    setPreviewing(true);
    setRunErrors([]);
  }

  // `plan` is cleared whenever a request fails, so it always matches the
  // last answered edits; while the next answer is pending it can't be run.
  const split = splitFieldErrors([...errors, ...runErrors]);
  const other = split.other;
  const byField = visibleFieldErrors(split.byField, form, touched);
  const disabledReason = busy
    ? null
    : previewing
      ? "Updating the plan…"
      : migrateDisabledReason({
          plan,
          errors,
          visibleErrors: Object.keys(byField).length + other.length,
          form,
          backupConfirmed: backup,
        });
  const current = previewing || disabledReason !== null ? null : plan;

  async function migrate() {
    if (busy || !canMigrate(current, backup)) return;
    setBusy(true);
    try {
      const report = await call<MigrationReport>("api/run", {
        edits: toRequest(form),
        backupConfirmed: backup,
      });
      onDone({ report });
    } catch (e) {
      setRunErrors(onRunFailure(e));
      setBusy(false);
    }
  }

  const canKeepAdmin = defaults.admin.kind === "create";
  const shown = plan;
  const warning = shown && urlWarning(shown);

  return (
    <form
      class="flow"
      onSubmit={(e) => {
        e.preventDefault();
        void migrate();
      }}
    >
      <h1>Migrate to multi-space</h1>
      <p>
        This server now hosts any number of spaces. Your folder becomes its
        first space: review the plan below, then migrate.
      </p>
      <Field label="Space name" error={byField.name}>
        <Input
          id="migrate-name"
          value={form.name}
          onInput={(e) => edit({ name: e.currentTarget.value })}
        />
      </Field>
      <Field label="URL" error={byField.prefix}>
        <UrlPrefixInput
          id="migrate-prefix"
          origin={location.origin}
          value={form.prefix}
          onInput={(prefix) => edit({ prefix })}
        />
      </Field>
      <Field
        label="Folder"
        hint="A folder under spaces/ in the server's data folder."
        error={byField.folder}
      >
        <Input
          id="migrate-folder"
          spellcheck={false}
          value={form.folder}
          onInput={(e) => edit({ folder: e.currentTarget.value })}
        />
      </Field>
      <Field label="Visitors without an account" error={byField.visitors}>
        <Select
          id="migrate-visitors"
          value={form.visitors}
          onChange={(e) =>
            edit({
              visitors: e.currentTarget.value as MigrateForm["visitors"],
            })
          }
        >
          <option value="none">No access</option>
          <option value="read">Read</option>
          <option value="write">Read &amp; write</option>
        </Select>
      </Field>
      <Field label="Administrator" error={byField.admin}>
        <Select
          id="migrate-admin"
          value={form.adminMode}
          onChange={(e) =>
            edit({
              adminMode: e.currentTarget.value as MigrateForm["adminMode"],
            })
          }
        >
          {canKeepAdmin && (
            <option value="keep">The SB_USER account, same password</option>
          )}
          <option value="new">Create a new administrator</option>
          <option value="none">No accounts: keep it open</option>
        </Select>
      </Field>
      {form.adminMode !== "none" && (
        <Field label="Username" error={byField.adminUsername}>
          <Input
            id="migrate-admin-username"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            autocomplete="username"
            value={form.adminUsername}
            onInput={(e) => edit({ adminUsername: e.currentTarget.value })}
            onBlur={() => touch("adminUsername")}
          />
        </Field>
      )}
      {form.adminMode === "new" && (
        <Field label="Password" error={byField.adminPassword}>
          <PasswordInput
            id="migrate-admin-password"
            autocomplete="new-password"
            value={form.adminPassword}
            onInput={(e) => edit({ adminPassword: e.currentTarget.value })}
            onBlur={() => touch("adminPassword")}
          />
        </Field>
      )}
      <FieldErrors errors={other} />

      {shown ? (
        <PlanPreview plan={shown} />
      ) : (
        errors.length > 0 && (
          <p class="sb-help-text">There is no plan to show for these edits.</p>
        )
      )}
      {warning && <Alert variant="warning">{warning}</Alert>}

      <CheckboxField
        label={BACKUP_LABEL}
        checked={backup}
        onChange={(e) => setBackup(e.currentTarget.checked)}
      />
      <div class="row">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || current === null}
        >
          {busy ? "Migrating…" : "Migrate"}
        </Button>
        {disabledReason && <span class="sb-help-text">{disabledReason}</span>}
      </div>
    </form>
  );
}

function PlanPreview({ plan }: { plan: MigrationPlan }) {
  return (
    <section>
      <h2>What will happen</h2>
      {plan.blockers.length > 0 && (
        <Alert variant="error">
          <p>The migration can't run yet:</p>
          <ul>
            {plan.blockers.map((blocker, i) => (
              <li key={i}>{blockerMessage(blocker)}</li>
            ))}
          </ul>
        </Alert>
      )}
      <MoveList moves={plan.moves} />
      <h3>Files written</h3>
      <ul>
        {filesWritten(plan).map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
      <EnvList
        title="Environment variables no longer needed"
        vars={plan.envToRemove}
      />
      {needsPrefixNote(plan) && <p class="sb-help-text">{PREFIX_NOTE}</p>}
      <details>
        <summary>Settings carried over</summary>
        <dl>
          {carriedSettings(plan).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function MoveList({ moves }: { moves: Move[] }) {
  return (
    <>
      <h3>Moves</h3>
      {moves.length === 0 ? (
        <p>Nothing to move.</p>
      ) : (
        <ul>
          {moves.map((move) => {
            const { from, to } = moveLabel(move);
            return (
              <li key={move.from}>
                <code>{from}</code> → <code>{to}</code>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Legacy env vars the server ignores once `spaces.json` exists. */
function EnvList({ title, vars }: { title: string; vars: string[] }) {
  if (vars.length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {vars.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Finishing a journaled run needs no backup confirmation: it already began. */
function InterruptedPage({
  notice,
  plan,
  error,
  onRunFailure,
  onDone,
}: {
  notice: string;
  plan: MigrationPlan | null;
  error: string | null;
  onRunFailure: (e: unknown) => FieldError[];
  onDone: (done: Done) => void;
}) {
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    try {
      const report = await call<MigrationReport>("api/run", {});
      onDone({ report });
    } catch (e) {
      setErrors(onRunFailure(e));
      setBusy(false);
    }
  }

  return (
    <div class="flow">
      <h1>{notice}</h1>
      <p>
        The migration stopped partway. Finishing it completes the remaining
        moves and writes from where it stopped.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <FieldErrors errors={errors.filter((e) => e.message !== error)} />
      {plan && <MoveList moves={plan.moves} />}
      <div class="row">
        <Button variant="primary" disabled={busy} onClick={() => void finish()}>
          {busy ? "Finishing…" : "Finish the migration"}
        </Button>
      </div>
    </div>
  );
}

/**
 * A run this page didn't start, or whose answer a proxy cut off. Polls
 * `api/status` until the run stops: then the status says what happened, or,
 * once multi-space has taken over this address, a reload shows the space.
 */
function RunningPage({
  onStopped,
  onDone,
}: {
  onStopped: () => void;
  onDone: (done: Done) => void;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    let latest: Done = {
      report: {
        moved: [],
        envToRemove: [],
        prefixNote: false,
        spacePrefix: "/",
      },
    };
    let reported = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      attempts++;
      try {
        const resp = await fetch(apiUrl("api/status", document.baseURI), {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "manual",
        });
        const body = await resp.json().catch(() => null);
        if (stopped) return;
        if (!stillMigrating(resp.status, body)) {
          if (reported) onDone(latest);
          else location.reload();
          return;
        }
        const status = body as MigrateStatus;
        if (status.report) {
          latest = { ...latest, report: status.report };
          reported = true;
        }
        if (!status.running) {
          onStopped();
          return;
        }
      } catch {
        // Unreachable for a moment: keep polling.
      }
      if (stopped) return;
      if (attempts >= SWAP_MAX_ATTEMPTS) {
        setSlow(true);
        return;
      }
      timer = setTimeout(check, SWAP_POLL_MS);
    };
    timer = setTimeout(check, SWAP_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <div class="flow">
      <h1>Migrating…</h1>
      <p>The migration is running. This page continues when it has finished.</p>
      {slow && (
        <Alert variant="error">
          The migration is taking longer than expected. Check the server log; if
          it has stopped, restart the server and reload this page.
        </Alert>
      )}
    </div>
  );
}

/** The files moved, but the server couldn't start serving them. */
function SwitchFailedPage({
  report,
  error,
}: {
  report: MigrationReport;
  error: string | null;
}) {
  return (
    <div class="flow">
      <h1>Migration complete</h1>
      <Alert variant="error">
        {error ??
          "The server could not switch to multi-space. Check the server log, then restart the server."}
      </Alert>
      <MoveList moves={report.moved} />
      <EnvList
        title="Environment variables to remove"
        vars={report.envToRemove}
      />
    </div>
  );
}

/** How long to wait for the multi-space stack to replace the migration server. */
const SWAP_POLL_MS = 500;
const SWAP_MAX_ATTEMPTS = 120;

type SwapState = "waiting" | "ready" | "slow";

/**
 * `api/run` answers after the swap, but a page that lost that answer (a proxy
 * gave up) only knows the run finished, and until the swap completes the space
 * URL still leads
 * back to this flow. Polls `api/status`, relative so it stays under a proxied
 * prefix, until the migration router stops answering it.
 */
function useSwap(): SwapState {
  const [state, setState] = useState<SwapState>("waiting");
  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      attempts++;
      try {
        const resp = await fetch(apiUrl("api/status", document.baseURI), {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "manual",
        });
        const body = await resp.json().catch(() => null);
        if (!stillMigrating(resp.status, body)) {
          if (!stopped) setState("ready");
          return;
        }
      } catch {
        // Unreachable for a moment: keep polling.
      }
      if (stopped) return;
      if (attempts >= SWAP_MAX_ATTEMPTS) {
        setState("slow");
        return;
      }
      timer = setTimeout(check, SWAP_POLL_MS);
    };
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return state;
}

function DonePage({ report }: Done) {
  const swap = useSwap();
  return (
    <div class="flow">
      <h1>Migration complete</h1>
      <p>
        Devices need to sign in again. Details are in <code>MIGRATION.md</code>{" "}
        in the server's data folder.
      </p>
      <MoveList moves={report.moved} />
      <EnvList
        title="Environment variables to remove"
        vars={report.envToRemove}
      />
      {report.prefixNote && <Alert variant="info">{PREFIX_NOTE}</Alert>}
      {swap === "waiting" ? (
        <p>Starting your space…</p>
      ) : (
        <>
          {swap === "slow" && (
            <Alert variant="warning">
              The server is taking longer than expected and may still be
              starting. If the links below lead back here, check the server log,
              then reload.
            </Alert>
          )}
          <div class="row">
            <ButtonLink
              variant="primary"
              href={reportSpaceUrl(report, location.origin)}
            >
              Open your space
            </ButtonLink>
            <ButtonLink href={dashboardUrl(location.origin)}>
              Open the Dashboard
            </ButtonLink>
          </div>
        </>
      )}
    </div>
  );
}
