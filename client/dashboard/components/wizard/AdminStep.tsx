import { Button, Input } from "@silverbulletmd/silverbullet/ui";
import { splitFieldErrors } from "../../field_errors.ts";
import { FieldErrors, InlineError } from "../../space_fields.tsx";
import type { FieldError } from "../../types.ts";
import type { AdminValues } from "../../wizard.ts";

/**
 * Step 1 of the setup wizard: the administrator account. Fully controlled —
 * the wizard owns the values so stepping back and forth does not lose them,
 * and so it still has the credentials to POST when step 2 finishes.
 */
export function AdminStep({
  values,
  onChange,
  errors,
  busy,
  onSubmit,
}: {
  values: AdminValues;
  onChange: (patch: Partial<AdminValues>) => void;
  errors: FieldError[];
  busy: boolean;
  onSubmit: () => void;
}) {
  const { byField, other } = splitFieldErrors(errors, [
    "adminUsername",
    "adminPassword",
    "adminPassword2",
  ]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h1>Welcome to SilverBullet!</h1>
      <p class="sb-help-text">Step 1 of 2</p>
      <p>
        This server has not been configured yet. DO NOT PANIC! It only takes two
        quick steps: first creating an administrator account, then configuring
        your first space. You can add more spaces and users later (if you were
        so to desire).
      </p>
      <FieldErrors errors={other} />
      <label for="setup-username">Username</label>
      <Input
        id="setup-username"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        autocomplete="username"
        aria-invalid={!!byField.adminUsername}
        aria-describedby={
          byField.adminUsername ? "setup-username-error" : undefined
        }
        value={values.username}
        onInput={(e) => onChange({ username: e.currentTarget.value })}
      />
      <InlineError id="setup-username-error" message={byField.adminUsername} />
      <p class="sb-help-text">
        It is wise, but not required, to create an admin account dedicated
        purely for admin purposes. You can add additional regular user accounts
        (with fewer permissions) later.
      </p>
      <label for="setup-password">Password</label>
      <Input
        id="setup-password"
        type="password"
        autocomplete="new-password"
        aria-invalid={!!byField.adminPassword}
        aria-describedby={
          byField.adminPassword ? "setup-password-error" : undefined
        }
        value={values.password}
        onInput={(e) => onChange({ password: e.currentTarget.value })}
      />
      <InlineError id="setup-password-error" message={byField.adminPassword} />
      <label for="setup-password2">Repeat password</label>
      <Input
        id="setup-password2"
        type="password"
        autocomplete="new-password"
        aria-invalid={!!byField.adminPassword2}
        aria-describedby={
          byField.adminPassword2 ? "setup-password2-error" : undefined
        }
        value={values.password2}
        onInput={(e) => onChange({ password2: e.currentTarget.value })}
      />
      <InlineError
        id="setup-password2-error"
        message={byField.adminPassword2}
      />
      <label for="setup-full-name">Full name (optional)</label>
      <Input
        id="setup-full-name"
        autocomplete="name"
        value={values.fullName}
        onInput={(e) => onChange({ fullName: e.currentTarget.value })}
      />
      <p class="sb-help-text">
        Full name and email are used to attribute changes in revision history
        only.
      </p>
      <label for="setup-email">Email (optional)</label>
      <Input
        id="setup-email"
        type="email"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        autocomplete="email"
        value={values.email}
        onInput={(e) => onChange({ email: e.currentTarget.value })}
      />
      <div class="row">
        <Button type="submit" variant="primary" disabled={busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}
