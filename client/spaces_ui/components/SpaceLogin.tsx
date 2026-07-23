import { useEffect, useState } from "preact/hooks";
import {
  base64Decode,
  deriveEncryptionKey,
  publishEncryptionKey,
} from "../encryption.ts";
import { LoginForm, type LoginValues } from "./LoginForm.tsx";

/** Values the server templates into the login shell (see auth.html). */
export type AuthConfig = {
  spaceName: string;
  encryptionSalt: string;
  rememberMeDays: number;
  accountManaged: boolean;
};

/**
 * A space's own login page, served at `<space>/.auth`. Unlike the Space
 * Manager's login this one owns two side effects the editor depends on:
 * registering the space's service worker, and deriving the client-encryption
 * key for it.
 */
export function SpaceLogin({ config }: { config: AuthConfig }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Registering here — not in the editor — is what makes the login page the
  // first thing that installs a space's worker, so it is already active by the
  // time the editor boots.
  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const workerURL = new URL("service_worker.js", document.baseURI);
    const scope = workerURL.pathname.slice(
      0,
      workerURL.pathname.lastIndexOf("/") + 1,
    );
    navigator.serviceWorker
      .register(workerURL, { type: "module", scope })
      .then(() => console.log("Service worker registered"))
      .catch((e) => console.error("Service worker registration failed", e));
  }, []);

  async function submit(values: LoginValues) {
    setBusy(true);
    setError("");
    const params = new URLSearchParams();
    params.append("username", values.username);
    params.append("password", values.password);
    if (values.rememberMe) params.append("rememberMe", "true");
    const from = new URLSearchParams(location.search).get("from");
    if (from) params.append("from", from);

    try {
      const response = await fetch(".auth", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        credentials: "include",
        body: params.toString(),
      });
      const body = await response.json();
      if (body.status === "error") {
        setError(body.error ?? "Login failed");
        setBusy(false);
        return;
      }

      if (values.clientEncryption) {
        localStorage.setItem("enableEncryption", "true");
        const key = await deriveEncryptionKey(
          `${values.username}:${values.password}`,
          base64Decode(config.encryptionSalt),
        );
        if (!(await publishEncryptionKey(key, config.accountManaged))) {
          // Without a worker holding the key the editor would boot, find no
          // key and bounce straight back here — say so instead of looping.
          setError(
            "Client encryption needs a service worker, which is not available. " +
              "Reload and try again, or log in without encryption.",
          );
          setBusy(false);
          return;
        }
      } else {
        localStorage.removeItem("enableEncryption");
      }

      location.href = body.redirect;
    } catch {
      setError("Could not reach the server — check your connection.");
      setBusy(false);
    }
  }

  return (
    <div class="center">
      <div class="flow floating-island">
        <LoginForm
          title={
            <>
              Login to <img src=".client/logo.png" style="height: 1ch" />{" "}
              {config.spaceName}
            </>
          }
          error={error}
          busy={busy}
          rememberMeDays={config.rememberMeDays}
          clientEncryption
          initialClientEncryption={!!localStorage.getItem("enableEncryption")}
          onSubmit={(values) => void submit(values)}
        />
        <footer>
          <a href="https://silverbullet.md">What is SilverBullet?</a>
        </footer>
      </div>
    </div>
  );
}
