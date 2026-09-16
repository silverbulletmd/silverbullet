import { Alert, Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import { adminApi, formatApiError } from "../api.ts";
import { SaveConfirmation, useNotification } from "../notifications.tsx";
import { dashboardUrl } from "../routes.ts";
import { OidcWizard, type ProviderStatus } from "./OidcWizard.tsx";

export function AuthenticationView({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const notify = useNotification("authentication");
  const [status, setStatus] = useState<ProviderStatus>();
  const [editing, setEditing] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    try {
      setStatus(await adminApi("GET", "authentication"));
      setError("");
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else setError(formatApiError(error));
    }
  }

  useEffect(() => {
    if (globalThis.isSecureContext !== false) void reload();
  }, []);

  async function disable() {
    setBusy(true);
    notify("");
    try {
      await adminApi("POST", "authentication/disable");
      notify("SSO disabled.");
      setConfirmDisable(false);
      await reload();
    } catch (error: any) {
      if (error.unauthorized) onUnauthorized();
      else setError(formatApiError(error));
    } finally {
      setBusy(false);
    }
  }

  if (globalThis.isSecureContext === false) {
    return (
      <Alert variant="info">
        SSO requires HTTPS or localhost. Sign in with a local username and
        password when using HTTP.
      </Alert>
    );
  }

  return (
    <div>
      <SaveConfirmation scope="authentication" />
      {error && <Alert variant="error">{error}</Alert>}
      {!status && !error && <p>Loading…</p>}
      {status &&
        (editing ? (
          <OidcWizard
            status={status}
            onUnauthorized={onUnauthorized}
            onCancel={() => {
              setEditing(false);
              void reload();
            }}
            onDone={() => {
              notify("SSO enabled.");
              setEditing(false);
              void reload();
            }}
          />
        ) : (
          <>
            <p>
              <b>{status.enabled ? "SSO is enabled." : "SSO is disabled."}</b>
            </p>
            <p>
              Local accounts can always sign in with a username and password.
            </p>
            {status.active && (
              <dl>
                <dt>Provider</dt>
                <dd>{status.active.buttonLabel}</dd>
                <dt>Issuer</dt>
                <dd>{status.active.issuer}</dd>
                <dt>Central login</dt>
                <dd>{status.active.centralOrigin}</dd>
              </dl>
            )}
            {status.draft && (
              <p>
                A saved provider configuration is{" "}
                {status.tested
                  ? "ready for review"
                  : "awaiting a successful sign-in test"}
                .
              </p>
            )}
            <div class="row">
              <Button variant="primary" onClick={() => setEditing(true)}>
                {status.active
                  ? "Edit"
                  : status.draft
                    ? "Continue setup"
                    : "Set up SSO"}
              </Button>
              {status.enabled && (
                <>
                  <a class="sb-button" href={dashboardUrl("/users/new")}>
                    Add SSO user
                  </a>
                  <Button
                    variant="danger"
                    onClick={() => setConfirmDisable(true)}
                  >
                    Disable SSO
                  </Button>
                </>
              )}
            </div>
            {confirmDisable && (
              <div>
                <p>
                  Disable SSO and revoke its browser sessions? Local accounts
                  remain available.
                </p>
                <div class="row">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      void disable();
                    }}
                  >
                    Confirm disable
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => setConfirmDisable(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        ))}
    </div>
  );
}
