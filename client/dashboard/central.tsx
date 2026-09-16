import { AuthHeader } from "./components/AuthHeader.tsx";
import { useServerName } from "./server_name.ts";
import { SignedOut } from "./components/SignedOut.tsx";
import { dashboardUrl } from "../dashboard_navigation.ts";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Alert, Button } from "@silverbulletmd/silverbullet/ui";
import { LoginForm, type LoginValues } from "./components/LoginForm.tsx";
import { CentralUnlock } from "./components/CentralUnlock.tsx";
import { base64Decode, deriveEncryptionKey } from "./encryption.ts";

const prefix = "/.auth/central";
async function request(path: string, body?: unknown) {
  const response = await fetch(
    `${prefix}/${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Sign-in failed. Please try again.");
  return result;
}

type Context = {
  csrf: string;
  encrypt: boolean;
  rememberMeDays: number;
  provider: { buttonLabel: string } | null;
  test: boolean;
  destination: string;
  encryptionSalt: string;
};

function CentralLogin({ attempt }: { attempt: string }) {
  const serverName = useServerName();
  const [context, setContext] = useState<Context>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restart, setRestart] = useState(false);
  useEffect(() => {
    let dispose = () => {};
    void request(`context?attempt=${encodeURIComponent(attempt)}`)
      .then((value: Context) => {
        setContext(value);
        if (!value.test) return;
        const origin = new URL(value.destination).origin;
        const receive = (event: MessageEvent) => {
          if (
            event.source !== window.opener ||
            event.origin !== origin ||
            event.data?.type !== "oidc-test-proof" ||
            event.data.attempt !== attempt ||
            typeof event.data.proof !== "string"
          )
            return;
          window.removeEventListener("message", receive);
          setBusy(true);
          void request("provider", {
            attempt,
            csrf: value.csrf,
            testProof: event.data.proof,
            rememberMe: false,
            clientEncryption: false,
          })
            .then((result) => location.replace(result.redirect))
            .catch((cause: Error) => {
              setError(cause.message);
              setBusy(false);
            });
        };
        window.addEventListener("message", receive);
        dispose = () => window.removeEventListener("message", receive);
        if (!window.opener)
          setError(
            "Open this test from the administrator’s Authentication page.",
          );
        else
          window.opener.postMessage(
            { type: "oidc-test-ready", attempt },
            origin,
          );
      })
      .catch((cause: Error) => setError(cause.message));
    return () => dispose();
  }, [attempt]);

  async function signIn(values: LoginValues, provider: boolean) {
    if (!context) return;
    const dashboard = /^\/\.dashboard(?:\/|$)/.test(
      new URL(context.destination).pathname,
    );
    const popup =
      !provider && values.clientEncryption && !dashboard
        ? window.open("about:blank", "_blank", "popup,width=600,height=720")
        : null;
    if (!provider && values.clientEncryption && !dashboard && !popup) {
      setError(
        "Allow the sign-in window to open so this browser can securely unlock the space.",
      );
      return;
    }
    setBusy(true);
    setError("");
    let cleanup = () => {};
    try {
      const key = popup
        ? await deriveEncryptionKey(
            `${values.username}:${values.password}`,
            base64Decode(context.encryptionSalt),
          )
        : undefined;
      const result = await request(provider ? "provider" : "local", {
        ...values,
        attempt,
        csrf: context.csrf,
      });
      if (!popup || !key) {
        location.replace(result.redirect);
        return;
      }
      const destinationOrigin = new URL(context.destination).origin;
      let delivered = false;
      const receive = (event: MessageEvent) => {
        if (
          event.source !== popup ||
          event.origin !== destinationOrigin ||
          event.data?.attempt !== attempt
        )
          return;
        if (event.data.type === "sb-encryption-ready") {
          delivered = true;
          popup.postMessage(
            { type: "sb-encryption-key", attempt, key },
            destinationOrigin,
          );
        } else if (event.data.type === "sb-encryption-complete" && delivered) {
          cleanup();
          popup.close();
          location.replace(context.destination);
        }
      };
      const timer = setInterval(() => {
        if (popup.closed) {
          cleanup();
          setBusy(false);
          setRestart(true);
          setError(
            "The unlock window closed before completion. Sign in again to retry.",
          );
        }
      }, 500);
      const deadline = setTimeout(() => {
        cleanup();
        popup.close();
        setBusy(false);
        setRestart(true);
        setError("The unlock attempt expired. Sign in again to retry.");
      }, 60_000);
      cleanup = () => {
        clearInterval(timer);
        clearTimeout(deadline);
        window.removeEventListener("message", receive);
      };
      window.addEventListener("message", receive);
      popup.location.replace(result.redirect);
    } catch (cause) {
      cleanup();
      popup?.close();
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      setBusy(false);
    }
  }
  if (!context) return <p role="status">{error || "Loading sign-in…"}</p>;
  if (context.test)
    return (
      <>
        <h1>Test provider sign-in</h1>
        {error ? (
          <Alert variant="error">{error}</Alert>
        ) : (
          <p role="status">Opening your sign-in provider…</p>
        )}
      </>
    );
  if (restart)
    return (
      <>
        <h1>Sign-in interrupted</h1>
        <Alert variant="error">{error}</Alert>
        <Button
          variant="primary"
          onClick={() => {
            const start = new URL(
              "/.auth/central/start",
              new URL(context.destination).origin,
            );
            start.searchParams.set("destination", context.destination);
            start.searchParams.set("encrypt", "true");
            location.replace(start.href);
          }}
        >
          Start new sign-in
        </Button>
      </>
    );
  return (
    <LoginForm
      title={serverName}
      error={error}
      busy={busy}
      rememberMeDays={context.rememberMeDays}
      clientEncryption
      initialClientEncryption={context.encrypt}
      clientEncryptionHint={
        /^\/\.dashboard(?:\/|$)/.test(new URL(context.destination).pathname)
          ? "Encryption is completed when you open a space on this device."
          : "SSO uses a separate passphrase to unlock encrypted data on this device."
      }
      providerLabel={context.provider?.buttonLabel}
      onProvider={(values) => void signIn(values, true)}
      onSubmit={(values) => void signIn(values, false)}
    />
  );
}
const params = new URLSearchParams(location.search);
render(
  <>
    <AuthHeader logo="assets/logo-dock-96x96.png" />
    <div class="center">
      <div class="flow floating-island">
        {location.pathname === "/.auth/central/signed-out" ? (
          <SignedOut
            requireRevocation
            onContinue={() => {
              void dashboardUrl("/login").then((url) => location.replace(url));
            }}
          />
        ) : params.has("resume") ? (
          <CentralUnlock resume={params.get("resume")!} />
        ) : (
          <CentralLogin attempt={params.get("attempt") || ""} />
        )}
      </div>
    </div>
  </>,
  document.getElementById("root")!,
);
