import {
  Alert,
  Button,
  Field,
  PasswordInput,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  base64Decode,
  deriveEncryptionKey,
  encryptionKeyVerifier,
  inspectEncryptionCache,
  publishEncryptionKey,
  readEncryptionKey,
  registerEncryptionWorker,
  validEncryptionKey,
} from "../encryption.ts";

type ResumeContext = {
  destination: string;
  scope: string;
  encrypt: boolean;
  username: string;
  loginMethod: "local" | "sso";
  encryptionSalt: string;
  centralOrigin: string;
  attempt: string;
};

export function CentralUnlock({ resume }: { resume: string }) {
  const [context, setContext] = useState<ResumeContext>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [phrase, setPhrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [existing, setExisting] = useState(false);
  const [preserveEncryption, setPreserveEncryption] = useState(false);
  const registration = useRef<ServiceWorkerRegistration>();
  const mounted = useRef(true);
  const receiving = useRef(false);
  const storageKey = (username: string) =>
    `sb-local-encryption-verifier:${username}`;

  async function finish(data: ResumeContext, key: string) {
    if (!validEncryptionKey(key))
      throw new Error("The local unlock key is invalid. Sign in again.");
    const verifier = await encryptionKeyVerifier(key, data.username);
    const saved = localStorage.getItem(storageKey(data.username));
    if (saved && saved !== verifier)
      throw new Error(
        "This passphrase does not unlock the existing local data. Use the original passphrase.",
      );
    const response = await fetch(new URL(".config", data.scope));
    if (!response.ok)
      throw new Error(
        "Could not check this space's local encryption settings. Try again.",
      );
    const config = await response.json();
    if (
      !config.enableClientEncryption ||
      typeof config.spaceFolderPath !== "string"
    )
      throw new Error("This space does not support local encryption.");
    const cache = await inspectEncryptionCache(
      data.scope,
      config.spaceFolderPath,
      key,
    );
    const encrypted = !!localStorage.getItem("enableEncryption");
    if (!encrypted && cache.plainHasData)
      throw new Error(
        "This browser already has local data. Synchronize and export it before changing encryption mode. Your existing cache has been preserved.",
      );
    if (
      encrypted &&
      !saved &&
      !cache.matching &&
      (cache.otherFiles || cache.plainHasData)
    )
      throw new Error(
        "This key does not match an existing local cache. Unlock it with the previous credentials before changing encryption. Your local data has been preserved.",
      );
    const worker =
      registration.current ?? (await registerEncryptionWorker(data.scope));
    if (!(await publishEncryptionKey(key, true, 10_000, worker)))
      throw new Error(
        "The space's service worker could not keep the unlock key. Reload and try again.",
      );
    localStorage.setItem(storageKey(data.username), verifier);
    localStorage.setItem("enableEncryption", "true");
    setPhrase("");
    setConfirmation("");
    if (data.loginMethod === "local" && window.opener) {
      window.opener.postMessage(
        {
          type: "sb-encryption-complete",
          attempt: data.attempt,
          destination: data.destination,
        },
        data.centralOrigin,
      );
      window.close();
    } else {
      location.replace(data.destination);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let removeListener = () => {};
    const start = async () => {
      try {
        const response = await fetch(
          `/.auth/central/resume?resume=${encodeURIComponent(resume)}`,
        );
        if (!response.ok)
          throw new Error(
            "This sign-in has expired. Start again from your space.",
          );
        const data: ResumeContext = await response.json();
        const destination = new URL(data.destination, location.origin);
        const scope = new URL(data.scope, location.origin);
        const dashboard =
          destination.pathname === "/.dashboard" ||
          destination.pathname.startsWith("/.dashboard/");
        if (
          destination.origin !== location.origin ||
          scope.origin !== location.origin ||
          !scope.pathname.endsWith("/") ||
          (!dashboard && !destination.pathname.startsWith(scope.pathname))
        )
          throw new Error("Invalid sign-in destination");
        data.destination = destination.href;
        data.scope = scope.href;
        if (new URL(data.centralOrigin).origin !== data.centralOrigin)
          throw new Error("Invalid central login origin");
        if (cancelled) return;
        if (dashboard) {
          if (data.encrypt) localStorage.setItem("enableEncryption", "true");
          location.replace(data.destination);
          return;
        }
        setContext(data);
        setExisting(
          !!localStorage.getItem(storageKey(data.username)) ||
            !!localStorage.getItem("enableEncryption"),
        );
        if (!data.encrypt) {
          if (localStorage.getItem("enableEncryption")) {
            setPreserveEncryption(true);
            setBusy(false);
            return;
          }
          location.replace(data.destination);
          return;
        }
        registration.current = await registerEncryptionWorker(data.scope);
        const key = await readEncryptionKey(registration.current);
        if (cancelled) return;
        if (key && (data.loginMethod !== "local" || !window.opener)) {
          await finish(data, key);
          return;
        }
        if (data.loginMethod === "sso") {
          setBusy(false);
          return;
        }
        const source = window.opener;
        if (!source) {
          setBusy(false);
          return;
        }
        const receive = (event: MessageEvent) => {
          if (
            event.source !== source ||
            event.origin !== data.centralOrigin ||
            event.data?.type !== "sb-encryption-key" ||
            event.data.attempt !== data.attempt ||
            !validEncryptionKey(event.data.key) ||
            receiving.current
          )
            return;
          receiving.current = true;
          void finish(data, event.data.key).catch((error: Error) => {
            if (!cancelled) {
              setError(error.message);
              setBusy(false);
            }
          });
        };
        addEventListener("message", receive);
        const timer = setTimeout(() => {
          if (!cancelled && !receiving.current) {
            setError(
              "The sign-in window could not provide the local key. Start a new sign-in.",
            );
            setBusy(false);
          }
        }, 30_000);
        removeListener = () => {
          clearTimeout(timer);
          removeEventListener("message", receive);
        };
        source.postMessage(
          { type: "sb-encryption-ready", attempt: data.attempt },
          data.centralOrigin,
        );
      } catch (error: any) {
        if (!cancelled) {
          setError(error.message ?? "Could not unlock local data");
          setBusy(false);
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      mounted.current = false;
      removeListener();
    };
  }, [resume]);

  async function unlock() {
    if (!context) return;
    if (!existing && phrase !== confirmation) {
      setError("The passphrases do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const key = await deriveEncryptionKey(
        `${context.username}:${phrase}`,
        base64Decode(context.encryptionSalt),
      );
      await finish(context, key);
    } catch (error: any) {
      if (mounted.current) {
        setError(error.message ?? "Could not unlock local data");
        setBusy(false);
      }
    }
  }

  const restart = context && new URL("/.auth/central/start", location.origin);
  if (restart && context) {
    restart.searchParams.set("destination", context.destination);
    restart.searchParams.set("encrypt", "true");
  }
  return (
    <>
      <h1>{existing ? "Unlock local data" : "Encrypt local data"}</h1>
      {error && <Alert variant="error">{error}</Alert>}
      {busy && <p role="status">Preparing local data…</p>}
      {!busy &&
        context &&
        (preserveEncryption ? (
          <>
            <p>
              Encryption is already enabled in this browser. Keep it enabled to
              preserve your existing local data. Synchronize and export your
              data before changing encryption mode.
            </p>
            <a class="sb-button sb-button-primary" href={restart!.href}>
              Continue with encryption
            </a>
          </>
        ) : context.loginMethod === "sso" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <p>
              {existing
                ? "Enter the original local passphrase to unlock this browser's data."
                : "Choose a passphrase for local data in this browser."}{" "}
              It stays on this device and is separate from your provider
              account.
            </p>
            <Field label="Local encryption passphrase">
              <PasswordInput
                id="local-passphrase"
                required
                autoComplete={existing ? "current-password" : "new-password"}
                value={phrase}
                onInput={(event) => setPhrase(event.currentTarget.value)}
              />
            </Field>
            {!existing && (
              <Field label="Confirm passphrase">
                <PasswordInput
                  id="local-passphrase-confirm"
                  required
                  autoComplete="new-password"
                  value={confirmation}
                  onInput={(event) =>
                    setConfirmation(event.currentTarget.value)
                  }
                />
              </Field>
            )}
            <div class="row">
              <Button type="submit" variant="primary">
                {existing ? "Unlock" : "Enable local encryption"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p>
              Sign in again to unlock local data with your password. Existing
              local data will be preserved.
            </p>
            <a class="sb-button sb-button-primary" href={restart!.href}>
              Sign in to unlock
            </a>
          </>
        ))}
    </>
  );
}
