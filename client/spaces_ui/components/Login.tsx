import { useState } from "preact/hooks";
import { api } from "../api.ts";
import { LoginForm } from "./LoginForm.tsx";

/**
 * The Space Manager's login. Shares its form with a space's own login page;
 * the credentials go to the Space Manager API rather than to a space's `.auth`.
 *
 * Client encryption is offered here but cannot be *completed* here: the key
 * lives in a space's service worker, and the Space Manager has none to hand it
 * to. So ticking the box only records the preference — the space's own login
 * page reads it back (`initialClientEncryption`), arrives pre-ticked, and does
 * the derivation. Without this the option would be unreachable for anyone who
 * starts at the Space Manager, which is now the front door.
 */
export function Login({
  onDone,
  title = "SilverBullet",
  rememberMeDays = 7,
}: {
  onDone: (username: string) => void;
  title?: string;
  rememberMeDays?: number;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <LoginForm
      title={title}
      error={error}
      busy={busy}
      rememberMeDays={rememberMeDays}
      clientEncryption
      clientEncryptionHint="Applied when you open a space, you will be requested to reauthenticate (for secure key exchange)."
      initialClientEncryption={!!localStorage.getItem("enableEncryption")}
      onSubmit={({ username, password, rememberMe, clientEncryption }) => {
        setBusy(true);
        setError("");
        // Recorded before the request so the preference survives even if the
        // login fails and the user retries elsewhere.
        if (clientEncryption) {
          localStorage.setItem("enableEncryption", "true");
        } else {
          localStorage.removeItem("enableEncryption");
        }
        api("POST", "api/login", { username, password, rememberMe })
          .then((result) => {
            if (result.status === "ok") onDone(username);
            else {
              setError(result.error ?? "Login failed");
              setBusy(false);
            }
          })
          .catch(() => {
            setError("Could not reach the server — check your connection.");
            setBusy(false);
          });
      }}
    />
  );
}
