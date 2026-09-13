import { AuthHeader } from "./AuthHeader.tsx";
import { SignedOut } from "./SignedOut.tsx";
import { redirectToCentral } from "../central_redirect.ts";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api.ts";
import { LoginForm } from "./LoginForm.tsx";

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
  const [checking, setChecking] = useState(true);
  const [signedOut, setSignedOut] = useState(
    new URLSearchParams(location.search).get("signedOut") === "true",
  );
  useEffect(() => {
    if (signedOut) return;
    void redirectToCentral(
      new URLSearchParams(location.search).get("next") || "/.spaces/",
    )
      .then((redirected) => {
        if (!redirected) setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [signedOut]);

  return (
    <>
      <AuthHeader logo="assets/logo-dock-96x96.png" />
      <div class="sb-auth-content flow">
        {signedOut ? (
          <SignedOut onContinue={() => setSignedOut(false)} />
        ) : checking ? (
          <p role="status">Loading sign-in…</p>
        ) : (
          <LoginForm
            title={title}
            error={error}
            busy={busy}
            rememberMeDays={rememberMeDays}
            clientEncryption={globalThis.isSecureContext}
            clientEncryptionHint="Applied when you open a space, you will be requested to reauthenticate (for secure key exchange)."
            initialClientEncryption={!!localStorage.getItem("enableEncryption")}
            onSubmit={({
              username,
              password,
              rememberMe,
              clientEncryption,
            }) => {
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
                  setError(
                    "Could not reach the server — check your connection.",
                  );
                  setBusy(false);
                });
            }}
          />
        )}
      </div>
    </>
  );
}
