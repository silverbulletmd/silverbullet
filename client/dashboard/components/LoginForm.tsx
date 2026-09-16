import { useState } from "preact/hooks";
import {
  Alert,
  Button,
  CheckboxField,
  Field,
  PasswordInput,
  Input,
} from "@silverbulletmd/silverbullet/ui";

export type LoginValues = {
  username: string;
  password: string;
  rememberMe: boolean;
  clientEncryption: boolean;
};

export function LoginForm({
  title,
  error,
  busy,
  rememberMeDays,
  clientEncryption = false,
  clientEncryptionHint,
  initialClientEncryption = false,
  children,
  onSubmit,
  providerLabel,
  onProvider,
}: {
  title: preact.ComponentChildren;
  error?: string;
  busy?: boolean;
  /** Show "Remember me (N days)" when set. */
  rememberMeDays?: number;
  /** Show the client-encryption opt-in. */
  clientEncryption?: boolean;
  /** Explanatory line under the client-encryption option, when it needs one. */
  clientEncryptionHint?: string;
  initialClientEncryption?: boolean;
  /** Extra content below the form (e.g. the login page's footer link). */
  children?: preact.ComponentChildren;
  providerLabel?: string;
  onProvider?: (values: LoginValues) => void;
  onSubmit: (values: LoginValues) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [encrypt, setEncrypt] = useState(initialClientEncryption);

  return (
    <form
      class="flow"
      id="login"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          username,
          password,
          rememberMe,
          clientEncryption: clientEncryption && encrypt,
        });
      }}
    >
      <h1>Log in</h1>
      <p class="sb-auth-description">Continue to {title}.</p>
      {error && <Alert variant="error">{error}</Alert>}
      {providerLabel && onProvider && (
        <>
          <Button
            disabled={busy}
            onClick={() =>
              onProvider({
                username: "",
                password: "",
                rememberMe,
                clientEncryption: clientEncryption && encrypt,
              })
            }
          >
            {providerLabel}
          </Button>
          <div role="separator">or use a local account</div>
        </>
      )}
      <Field label="Username">
        <Input
          id="username"
          name="username"
          autocapitalize="off"
          autocomplete="username"
          autocorrect="off"
          autoFocus
          value={username}
          onInput={(event) => setUsername(event.currentTarget.value)}
        />
      </Field>
      <Field label="Password">
        <PasswordInput
          id="password"
          toggleId="togglePassword"
          name="password"
          autocomplete="current-password"
          value={password}
          onInput={(event) => setPassword(event.currentTarget.value)}
        />
      </Field>
      {rememberMeDays !== undefined && (
        <CheckboxField
          id="rememberMe"
          label={`Remember me (${rememberMeDays} days)`}
          checked={rememberMe}
          onChange={(event) => setRememberMe(event.currentTarget.checked)}
        />
      )}
      {clientEncryption && (
        <CheckboxField
          id="clientEncryption"
          label="Encrypt local data on this device"
          checked={encrypt}
          onChange={(event) => setEncrypt(event.currentTarget.checked)}
          hint={encrypt ? clientEncryptionHint : undefined}
        />
      )}
      <div style="--space: 1.8rem">
        <Button type="submit" variant="primary" disabled={busy}>
          Log in
        </Button>
      </div>
      {children}
    </form>
  );
}
