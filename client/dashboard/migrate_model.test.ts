import { describe, expect, test } from "vitest";
import {
  adminIncomplete,
  ANON_NOTICE,
  apiUrl,
  blockerMessage,
  canMigrate,
  carriedSettings,
  filesWritten,
  formFromDefaults,
  gateFields,
  INTERRUPTED_NOTICE,
  type MigrateForm,
  type MigrationPlan,
  moveLabel,
  needsPrefixNote,
  migrateDisabledReason,
  parseFailure,
  reportSpaceUrl,
  splitFieldErrors,
  stillMigrating,
  touchedBy,
  toRequest,
  URL_WARNING,
  urlWarning,
  view,
  visibleFieldErrors,
} from "./migrate_model.ts";

const FORM: MigrateForm = {
  name: "Notes",
  prefix: "/wiki",
  folder: "notes",
  visitors: "none",
  adminMode: "keep",
  adminUsername: "pat",
  adminPassword: "",
};

function plan(patch: Partial<MigrationPlan> = {}): MigrationPlan {
  return {
    moves: [{ from: "/data/index.md", to: "/data/spaces/notes/index.md" }],
    spaceId: "abc",
    space: {
      name: "Notes",
      folder: "spaces/notes",
      binding: { prefix: "/wiki" },
      access: "none",
      readOnly: false,
      shell: { enabled: false, whitelist: [] },
      indexPage: "index",
      description: "",
      themeColor: "#e1e1e1",
      headHtml: "",
      spaceIgnore: "",
      logPush: false,
      revisions: "managed",
      clientIdentityPath: "/data",
    },
    admin: { kind: "fromEnv", username: "pat" },
    apiToken: false,
    searchModel: null,
    runtimeApi: true,
    runtimeIdleTimeout: null,
    envToRemove: ["SB_USER"],
    urlChanged: false,
    blockers: [],
    ...patch,
  };
}

describe("toRequest", () => {
  test("keeps the env admin by username only", () => {
    expect(toRequest(FORM)).toEqual({
      name: "Notes",
      prefix: "/wiki",
      folder: "notes",
      visitors: "none",
      admin: { kind: "create", username: "pat" },
    });
  });

  test("a new admin carries its password", () => {
    expect(
      toRequest({ ...FORM, adminMode: "new", adminPassword: "s:cret" }).admin,
    ).toEqual({ kind: "createNew", username: "pat", password: "s:cret" });
  });

  test("no accounts", () => {
    expect(toRequest({ ...FORM, adminMode: "none" }).admin).toEqual({
      kind: "noAccounts",
    });
  });

  test("round-trips the server's defaults", () => {
    const defaults = {
      name: "Notes",
      prefix: "/",
      folder: "notes",
      visitors: "write" as const,
      admin: { kind: "createNew" as const, username: "" },
    };
    const form = formFromDefaults(defaults);
    expect(form.adminMode).toBe("new");
    expect(toRequest(form)).toEqual({
      ...defaults,
      admin: { kind: "createNew", username: "", password: "" },
    });
  });
});

describe("urlWarning", () => {
  test("only when the URL changes", () => {
    expect(urlWarning(plan())).toBeNull();
    expect(urlWarning(plan({ urlChanged: true }))).toBe(
      "Devices will need to sign in and download the space again. Edits made offline and not yet synced will not carry over.",
    );
    expect(URL_WARNING).toBe(urlWarning(plan({ urlChanged: true })));
  });
});

describe("canMigrate", () => {
  test("needs a plan without blockers and the backup checkbox", () => {
    expect(canMigrate(plan(), true)).toBe(true);
    expect(canMigrate(plan(), false)).toBe(false);
    expect(canMigrate(null, true)).toBe(false);
    expect(
      canMigrate(
        plan({ blockers: [{ kind: "collision", name: "spaces" }] }),
        true,
      ),
    ).toBe(false);
    expect(
      canMigrate(plan({ blockers: [{ kind: "notWritable" }] }), true),
    ).toBe(false);
  });
});

describe("gate", () => {
  test("credentials or a setup code", () => {
    const creds = gateFields({
      gate: "credentials",
      signedIn: false,
      interrupted: false,
    });
    expect(creds.map((f) => f.name)).toEqual(["username", "password"]);
    expect(creds[1].type).toBe("password");
    const code = gateFields({
      gate: "code",
      signedIn: false,
      interrupted: false,
    });
    expect(code.map((f) => f.name)).toEqual(["code"]);
  });

  test("anonymous callers see only the notice and the gate", () => {
    for (const interrupted of [false, true]) {
      const v = view({ gate: "code", signedIn: false, interrupted });
      expect(v).toEqual({
        kind: "gate",
        notice: "This server is being upgraded, check back soon.",
        fields: gateFields({ gate: "code", signedIn: false, interrupted }),
      });
    }
    expect(ANON_NOTICE).toBe("This server is being upgraded, check back soon.");
  });

  test("signed in: the plan, or the interrupted migration", () => {
    const defaults = toRequest(FORM);
    expect(
      view({ gate: "code", signedIn: true, interrupted: false, defaults }),
    ).toEqual({ kind: "plan", defaults });
    const pendingPlan = plan();
    expect(
      view({ gate: "code", signedIn: true, interrupted: true, pendingPlan }),
    ).toEqual({
      kind: "interrupted",
      notice: "A migration was interrupted",
      plan: pendingPlan,
      error: null,
    });
    expect(
      view({ gate: "code", signedIn: true, interrupted: true, error: "bad" }),
    ).toEqual({
      kind: "interrupted",
      notice: INTERRUPTED_NOTICE,
      plan: null,
      error: "bad",
    });
  });

  test("a failed run's error shows on the interrupted migration", () => {
    const pendingPlan = plan();
    expect(
      view({
        gate: "code",
        signedIn: true,
        interrupted: true,
        pendingPlan,
        lastError: 'Could not move "attachments"',
      }),
    ).toEqual({
      kind: "interrupted",
      notice: INTERRUPTED_NOTICE,
      plan: pendingPlan,
      error: 'Could not move "attachments"',
    });
  });
});

describe("running", () => {
  test("a run in progress is never shown as interrupted", () => {
    expect(
      view({
        gate: "code",
        signedIn: true,
        interrupted: true,
        running: true,
        pendingPlan: plan(),
      }),
    ).toEqual({ kind: "running" });
    expect(
      view({ gate: "code", signedIn: false, interrupted: true, running: true })
        .kind,
    ).toBe("gate");
  });

  test("a finished run whose switch to multi-space failed says so", () => {
    const report = {
      moved: [],
      envToRemove: ["SB_USER"],
      prefixNote: false,
      spacePrefix: "/",
    };
    expect(
      view({
        gate: "code",
        signedIn: true,
        interrupted: false,
        running: true,
        report,
      }),
    ).toEqual({ kind: "running" });
    expect(
      view({
        gate: "code",
        signedIn: true,
        interrupted: false,
        running: false,
        report,
        lastError: "could not switch",
      }),
    ).toEqual({ kind: "switchFailed", report, error: "could not switch" });
  });

  test("a report without an error means the switch just happened", () => {
    const report = {
      moved: [],
      envToRemove: [],
      prefixNote: true,
      spacePrefix: "/wiki",
    };
    expect(
      view({
        gate: "code",
        signedIn: true,
        interrupted: false,
        running: false,
        report,
      }),
    ).toEqual({ kind: "swapped", report });
    expect(reportSpaceUrl(report, "https://h.test")).toBe(
      "https://h.test/wiki/",
    );
    expect(
      reportSpaceUrl({ ...report, spacePrefix: "/" }, "https://h.test"),
    ).toBe("https://h.test/");
  });
});

describe("blockers", () => {
  test("a mount names its path", () => {
    expect(
      blockerMessage({ kind: "mount", path: "/data/attachments" }),
    ).toContain('"/data/attachments" is a separate mount');
  });
});

describe("errors", () => {
  test("field errors go on their fields, the rest is general", () => {
    const { byField, other } = splitFieldErrors([
      { field: "adminUsername", message: "invalid username" },
      { field: "adminPassword", message: "password must not be empty" },
      { field: "", message: "could not list /data" },
      { field: "shell", message: "odd" },
    ]);
    expect(byField).toEqual({
      adminUsername: "invalid username",
      adminPassword: "password must not be empty",
    });
    expect(other).toEqual([
      { field: "", message: "could not list /data" },
      { field: "shell", message: "odd" },
    ]);
  });

  test("API failures become field errors", () => {
    const fields = [{ field: "folder", message: "folder must not be empty" }];
    expect(parseFailure(400, { errors: fields })).toEqual(fields);
    expect(
      parseFailure(409, {
        error: "This folder was already migrated. Reload the page.",
      }),
    ).toEqual([
      {
        field: "",
        message: "This folder was already migrated. Reload the page.",
      },
    ]);
    expect(parseFailure(502, null)).toEqual([
      { field: "", message: "Request failed (HTTP 502)" },
    ]);
  });
});

describe("urls", () => {
  test("API calls stay under the page's own prefix", () => {
    expect(apiUrl("api/plan", "https://h.test/wiki/.setup/migrate/")).toBe(
      "https://h.test/wiki/.setup/migrate/api/plan",
    );
    expect(apiUrl("api/status", "http://h.test/.setup/migrate/")).toBe(
      "http://h.test/.setup/migrate/api/status",
    );
  });
});

describe("plan summary", () => {
  test("files written", () => {
    expect(filesWritten(plan())).toEqual([
      "spaces.json",
      "users.json",
      "MIGRATION.md",
    ]);
    expect(
      filesWritten(
        plan({ admin: { kind: "noAccounts" }, searchModel: "bge-small" }),
      ),
    ).toEqual(["spaces.json", "users.json", "MIGRATION.md", "server.json"]);
    expect(filesWritten(plan({ runtimeApi: false }))).toContain("server.json");
    expect(filesWritten(plan({ runtimeIdleTimeout: 5 }))).toContain(
      "server.json",
    );
  });

  test("runtime settings carried over", () => {
    const settings = Object.fromEntries(
      carriedSettings(plan({ runtimeApi: false, runtimeIdleTimeout: 5 })),
    );
    expect(settings["Runtime API"]).toBe("off");
    expect(settings["Runtime idle timeout"]).toBe("5 minutes");
    expect(
      Object.fromEntries(carriedSettings(plan({ runtimeIdleTimeout: 0 })))[
        "Runtime idle timeout"
      ],
    ).toBe("never");
    const defaults = Object.keys(Object.fromEntries(carriedSettings(plan())));
    expect(defaults).not.toContain("Runtime API");
    expect(defaults).not.toContain("Runtime idle timeout");
  });

  test("carried-over settings", () => {
    const p = plan({ apiToken: true, searchModel: "bge-small" });
    p.space.readOnly = true;
    p.space.shell = { enabled: true, whitelist: ["ls", "git"] };
    const settings = Object.fromEntries(carriedSettings(p));
    expect(settings["Index page"]).toBe("index");
    expect(settings["Read-only"]).toBe("yes");
    expect(settings.Shell).toBe("ls, git");
    expect(settings["API token"]).toBe(
      "SB_AUTH_TOKEN becomes the administrator's API token",
    );
    expect(settings["Search model"]).toBe("bge-small");
    expect(
      Object.keys(Object.fromEntries(carriedSettings(plan()))),
    ).not.toContain("API token");
  });
});

describe("moves and prefixes", () => {
  test("moves read relative to the data root", () => {
    expect(
      moveLabel({ from: "/data/.git", to: "/data/spaces/notes/.git" }),
    ).toEqual({ from: ".git", to: "spaces/notes/.git" });
  });

  test("the prefix note, for a prefixed space or a former prefix", () => {
    expect(needsPrefixNote(plan())).toBe(true);
    const root = plan();
    root.space.binding = { prefix: "" };
    expect(needsPrefixNote(root)).toBe(false);
    root.space.formerPrefixes = ["/wiki"];
    expect(needsPrefixNote(root)).toBe(true);
  });
});

describe("stillMigrating", () => {
  test("only the migration router answers api/status with a gate", () => {
    expect(
      stillMigrating(200, { gate: "code", signedIn: true, interrupted: false }),
    ).toBe(true);
    expect(stillMigrating(404, null)).toBe(false);
    expect(stillMigrating(401, { error: "x" })).toBe(false);
    // An opaque redirect (fetch with redirect: "manual") reports status 0.
    expect(stillMigrating(0, null)).toBe(false);
    expect(stillMigrating(200, null)).toBe(false);
    expect(stillMigrating(200, { status: "ok" })).toBe(false);
  });
});

describe("field error visibility", () => {
  const byField = {
    adminUsername: "invalid username",
    adminPassword: "password must not be empty",
    visitors: "without accounts, visitors need read or read & write access",
    admin: "SB_USER is not set; create a new administrator",
  };
  const blank: MigrateForm = {
    ...FORM,
    adminMode: "new",
    adminUsername: "",
    adminPassword: "",
  };

  test("pristine empty admin fields hide their errors, others always show", () => {
    expect(visibleFieldErrors(byField, blank, {})).toEqual({
      visitors: byField.visitors,
      admin: byField.admin,
    });
  });

  test("an edited or left admin field shows its error", () => {
    expect(
      visibleFieldErrors(byField, blank, { adminUsername: true }),
    ).toMatchObject({ adminUsername: byField.adminUsername });
    expect(
      visibleFieldErrors(byField, blank, { adminUsername: true }),
    ).not.toHaveProperty("adminPassword");
  });

  test("a prefilled admin username shows its error", () => {
    expect(
      visibleFieldErrors(byField, { ...blank, adminUsername: "a b" }, {}),
    ).toHaveProperty("adminUsername");
  });

  test("only edits of the admin fields touch them", () => {
    expect(touchedBy({ adminMode: "none" })).toEqual([]);
    expect(touchedBy({ visitors: "read", adminUsername: "x" })).toEqual([
      "adminUsername",
    ]);
  });
});

describe("migrateDisabledReason", () => {
  const form: MigrateForm = {
    ...FORM,
    adminMode: "new",
    adminUsername: "admin",
    adminPassword: "pw",
  };
  const ok = {
    plan: plan(),
    errors: [],
    visibleErrors: 0,
    form,
    backupConfirmed: true,
  };

  test("is null when the plan can run", () => {
    expect(migrateDisabledReason(ok)).toBeNull();
  });

  test("says why, most pressing first", () => {
    expect(
      migrateDisabledReason({ ...ok, form: { ...form, adminPassword: "" } }),
    ).toBe("Choose an administrator username and password");
    expect(
      migrateDisabledReason({
        ...ok,
        form: { ...form, adminMode: "keep", adminUsername: "" },
      }),
    ).toBe("Choose an administrator username");
    expect(
      migrateDisabledReason({
        ...ok,
        errors: [{ field: "prefix", message: "bad" }],
        visibleErrors: 1,
      }),
    ).toBe("Fix the errors above");
    expect(
      migrateDisabledReason({
        ...ok,
        plan: plan({ blockers: [{ kind: "notWritable" }] }),
      }),
    ).toBe("Resolve the blockers");
    expect(migrateDisabledReason({ ...ok, backupConfirmed: false })).toBe(
      "Confirm you have a backup",
    );
    expect(migrateDisabledReason({ ...ok, plan: null })).toBe(
      "Waiting for the plan",
    );
  });

  test("hidden admin errors are explained by the incomplete admin", () => {
    expect(
      migrateDisabledReason({
        ...ok,
        form: { ...form, adminUsername: "" },
        errors: [{ field: "adminUsername", message: "invalid username" }],
      }),
    ).toBe("Choose an administrator username and password");
  });
});
