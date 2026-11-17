import {
  Alert,
  Button,
  CheckboxField,
  Field,
  Input,
  PasswordInput,
} from "@silverbulletmd/silverbullet/ui";
import { useState } from "preact/hooks";

export type LoginValues = {
  username: string;
  password: string;
  /** "Shared computer": the session ends with the browser and nothing is
   * kept on the device. */
  sharedComputer: boolean;
  clientEncryption: boolean;
};

export function LoginForm({
  title,
  error,
  busy,
  showSharedComputer = false,
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
  /** Show the "Shared computer" option. */
  showSharedComputer?: boolean;
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
  const [sharedComputer, setSharedComputer] = useState(false);
  const [encrypt, setEncrypt] = useState(initialClientEncryption);
  // A shared computer keeps no local data, so there is nothing to encrypt.
  const offerEncryption = clientEncryption && !sharedComputer;

  return (
    <form
      class="flow"
      id="login"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          username,
          password,
          sharedComputer,
          clientEncryption: offerEncryption && encrypt,
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
                sharedComputer,
                clientEncryption: offerEncryption && encrypt,
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
      {showSharedComputer && (
        <CheckboxField
          id="sharedComputer"
          label="Shared computer (sign out when the browser closes)"
          checked={sharedComputer}
          onChange={(event) => setSharedComputer(event.currentTarget.checked)}
        />
      )}
      {offerEncryption && (
        <CheckboxField
          id="clientEncryption"
          label="Encrypt local data on this device"
          checked={encrypt}
          onChange={(event) => setEncrypt(event.currentTarget.checked)}
          hint={encrypt ? clientEncryptionHint : undefined}
        />
      )}
      <div style="--sb-space: 1.8rem">
        <Button type="submit" variant="primary" disabled={busy}>
          Log in
        </Button>
      </div>
      {children}
    </form>
  );
}
