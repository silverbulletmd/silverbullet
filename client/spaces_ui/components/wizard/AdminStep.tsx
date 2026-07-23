import { Button, Input } from "@silverbulletmd/silverbullet/ui";
import { FieldErrors } from "../../space_fields.tsx";
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
        This server has not been configured yet. Yet, not to worry, it only
        takes two quick steps: first create an administrator account, then
        configure your first space. You can add more spaces and users later (if
        you were so to desire) in the spaces UI.
      </p>
      <FieldErrors errors={errors} />
      <label for="setup-username">Username</label>
      <Input
        id="setup-username"
        value={values.username}
        onInput={(e) => onChange({ username: e.currentTarget.value })}
      />
      <label for="setup-password">Password</label>
      <Input
        id="setup-password"
        type="password"
        value={values.password}
        onInput={(e) => onChange({ password: e.currentTarget.value })}
      />
      <label for="setup-password2">Repeat password</label>
      <Input
        id="setup-password2"
        type="password"
        value={values.password2}
        onInput={(e) => onChange({ password2: e.currentTarget.value })}
      />
      <div class="row">
        <Button type="submit" variant="primary" disabled={busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}
