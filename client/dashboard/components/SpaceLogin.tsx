import { AuthHeader } from "./AuthHeader.tsx";
import { useEffect, useState } from "preact/hooks";
import { redirectToCentral } from "../central_redirect.ts";
import {
  base64Decode,
  deriveEncryptionKey,
  inspectEncryptionCache,
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
 * Dashboard login, this one owns two side effects the editor depends on:
 * registering the space's service worker, and deriving the client-encryption
 * key for it.
 */
export function SpaceLogin({ config }: { config: AuthConfig }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(config.accountManaged);

  useEffect(() => {
    if (config.accountManaged)
      void redirectToCentral(
        new URLSearchParams(location.search).get("from") ||
          new URL(".", document.baseURI).href,
      )
        .then((redirected) => {
          if (!redirected) setChecking(false);
        })
        .catch(() => setChecking(false));
  }, []);

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

      const encrypted = !!localStorage.getItem("enableEncryption");
      if (encrypted && !values.clientEncryption) {
        setError(
          "Encryption is already enabled in this browser. Keep it enabled to preserve your existing local data. Synchronize and export your data before changing encryption mode.",
        );
        setBusy(false);
        return;
      }

      if (values.clientEncryption) {
        const key = await deriveEncryptionKey(
          `${values.username}:${values.password}`,
          base64Decode(config.encryptionSalt),
        );
        const configResponse = await fetch(".config", {
          credentials: "include",
        });
        if (!configResponse.ok) {
          setError(
            "Could not check this space's local encryption settings. Try again.",
          );
          setBusy(false);
          return;
        }
        const spaceConfig = await configResponse.json();
        if (
          !spaceConfig.enableClientEncryption ||
          typeof spaceConfig.spaceFolderPath !== "string"
        ) {
          setError("This space does not support local encryption.");
          setBusy(false);
          return;
        }
        let cache;
        try {
          cache = await inspectEncryptionCache(
            new URL(".", document.baseURI).href,
            spaceConfig.spaceFolderPath,
            key,
          );
        } catch (error: any) {
          setError(
            error.message ??
              "Could not inspect this browser's existing local data.",
          );
          setBusy(false);
          return;
        }
        if (!encrypted && cache.plainHasData) {
          setError(
            "This browser already has local data. Synchronize and export it before changing encryption mode. Your existing cache has been preserved.",
          );
          setBusy(false);
          return;
        }
        if (
          encrypted &&
          !cache.matching &&
          (cache.otherFiles || cache.plainHasData)
        ) {
          setError(
            "This key does not match an existing local cache. Unlock it with the previous credentials before changing encryption. Your local data has been preserved.",
          );
          setBusy(false);
          return;
        }
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
        localStorage.setItem("enableEncryption", "true");
      } else {
        localStorage.removeItem("enableEncryption");
      }

      location.href = body.redirect;
    } catch {
      setError("Could not reach the server — check your connection.");
      setBusy(false);
    }
  }

  if (checking)
    return (
      <div class="center">
        <p role="status">Loading sign-in…</p>
      </div>
    );

  return (
    <>
      <AuthHeader logo=".client/logo.png" />
      <div class="center">
        <div class="flow floating-island">
          <LoginForm
            title={config.spaceName}
            error={error}
            busy={busy}
            rememberMeDays={config.rememberMeDays}
            clientEncryption={globalThis.isSecureContext}
            initialClientEncryption={
              new URLSearchParams(location.search).get("encrypt") === "true" ||
              !!localStorage.getItem("enableEncryption")
            }
            onSubmit={(values) => void submit(values)}
          />
          <footer>
            <a href="https://silverbullet.md">What is SilverBullet?</a>
          </footer>
        </div>
      </div>
    </>
  );
}
