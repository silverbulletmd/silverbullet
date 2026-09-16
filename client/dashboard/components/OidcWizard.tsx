import { copyToClipboard } from "../../clipboard.ts";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Select,
} from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { adminApi, formatApiError } from "../api.ts";

export type ProviderConfig = {
  providerId?: string;
  issuer: string;
  centralOrigin: string;
  clientId: string;
  clientSecret?: string;
  workspaceDomain?: string | null;
  buttonLabel: string;
  hasClientSecret?: boolean;
};

type ProviderMode = "google" | "oidc";

export type ProviderStatus = {
  primaryUrl?: string | null;
  revision: number;
  enabled: boolean;
  active: ProviderConfig | null;
  draft: ProviderConfig | null;
  tested: boolean;
};

type ConnectionTest = {
  status: "running" | "success" | "error";
  email?: string;
  emailVerified?: boolean;
  fullName?: string;
  issuer?: string;
  subject?: string;
  workspaceDomain?: string;
  admissionAllowed?: boolean;
  provisionedUsername?: string | null;
  error?: string;
};

export function OidcWizard({
  status,
  onDone,
  onCancel,
  onUnauthorized,
}: {
  status: ProviderStatus;
  onDone: () => void;
  onCancel: () => void;
  onUnauthorized: () => void;
}) {
  const savedConfig = status.draft ?? status.active;
  const [providerMode, setProviderMode] = useState<ProviderMode>(() =>
    savedConfig ? (savedConfig.workspaceDomain ? "google" : "oidc") : "google",
  );
  const [config, setConfig] = useState<ProviderConfig>(() => ({
    ...(savedConfig ?? {
      issuer: "https://accounts.google.com",
      centralOrigin: location.origin,
      clientId: "",
      buttonLabel: "Sign in with Google",
      workspaceDomain: "",
    }),
    ...(status.primaryUrl ? { centralOrigin: status.primaryUrl } : {}),
    clientSecret: "",
  }));
  const [revision, setRevision] = useState<number | undefined>(
    status.tested ? status.revision : undefined,
  );
  const [result, setResult] = useState<ConnectionTest | undefined>(
    status.tested ? { status: "success" } : undefined,
  );
  const [testId, setTestId] = useState<string>();
  const [testUrl, setTestUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [replace, setReplace] = useState(false);
  const popup = useRef<Window | null>(null);
  const testProof = useRef<{ id: string; proof: string; origin: string }>();
  const mounted = useRef(true);
  const callbackUrl = `${config.centralOrigin.replace(/\/+$/, "")}/.auth/central/oidc/callback`;
  const replacement =
    !!status.active &&
    (status.active.issuer !== config.issuer ||
      status.active.clientId !== config.clientId);

  function failed(error: any) {
    if (error.unauthorized) onUnauthorized();
    else setError(formatApiError(error));
  }

  function edit(changes: Partial<ProviderConfig>) {
    setConfig({ ...config, ...changes });
    setResult(undefined);
    setRevision(undefined);
    setTestId(undefined);
    setTestUrl("");
    testProof.current = undefined;
    setCopied(false);
    setReplace(false);
    setError("");
  }

  useEffect(
    () => () => {
      mounted.current = false;
      popup.current?.close();
    },
    [],
  );

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const proof = testProof.current;
      if (
        !proof ||
        event.source !== popup.current ||
        event.origin !== proof.origin ||
        event.data?.type !== "oidc-test-ready" ||
        event.data.attempt !== proof.id
      )
        return;
      popup.current?.postMessage(
        { type: "oidc-test-proof", attempt: proof.id, proof: proof.proof },
        proof.origin,
      );
    };
    addEventListener("message", receive);
    return () => removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (!testId) return;
    let cancelled = false;
    let pending = false;
    const deadline = Date.now() + 10 * 60_000;
    const poll = async () => {
      if (pending || cancelled) return;
      if (Date.now() > deadline) {
        setResult({
          status: "error",
          error: "The test expired. Start a new sign-in test.",
        });
        setTestId(undefined);
        return;
      }
      pending = true;
      try {
        const next: ConnectionTest = await adminApi(
          "GET",
          `authentication/test/${encodeURIComponent(testId)}`,
        );
        if (cancelled) return;
        setResult(next);
        if (next.status !== "running") {
          setTestId(undefined);
          popup.current?.close();
          setTestUrl("");
          testProof.current = undefined;
        }
      } catch (error: any) {
        if (!cancelled) {
          failed(error);
          setTestId(undefined);
        }
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [testId]);

  async function testSignIn() {
    popup.current = window.open(
      "about:blank",
      "_blank",
      "popup,width=600,height=720",
    );
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const saved: { revision: number } = await adminApi(
        "PUT",
        "authentication/draft",
        config,
      );
      if (!mounted.current) return;
      setRevision(saved.revision);
      setConfig({
        ...config,
        clientSecret: "",
        hasClientSecret: !!config.clientSecret || config.hasClientSecret,
      });
      const attempt: { id: string; url: string; proof: string } =
        await adminApi("POST", "authentication/test", {
          revision: saved.revision,
        });
      if (!mounted.current) return;
      testProof.current = {
        id: attempt.id,
        proof: attempt.proof,
        origin: new URL(config.centralOrigin).origin,
      };
      setTestUrl(attempt.url);
      setResult({ status: "running" });
      setTestId(attempt.id);
      if (popup.current && !popup.current.closed)
        popup.current.location.replace(attempt.url);
    } catch (error: any) {
      popup.current?.close();
      if (mounted.current) failed(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    setError("");
    try {
      await adminApi("POST", "authentication/activate", {
        revision,
        replace: replacement && replace,
      });
      onDone();
    } catch (error: any) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Connect a sign-in provider</h2>
      <p>
        Local accounts remain available. SSO accounts must be added by an
        administrator.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void testSignIn();
        }}
      >
        <fieldset disabled={busy || !!testId}>
          <label for="oidc-provider">Provider</label>
          <Select
            id="oidc-provider"
            value={providerMode}
            onChange={(event) => {
              const mode = event.currentTarget.value as ProviderMode;
              setProviderMode(mode);
              edit({
                issuer: mode === "google" ? "https://accounts.google.com" : "",
                workspaceDomain: "",
                buttonLabel:
                  mode === "google"
                    ? "Sign in with Google"
                    : "Sign in with SSO",
              });
            }}
          >
            <option value="google">Google Workspace</option>
            <option value="oidc">OpenID Connect</option>
          </Select>
          <label for="oidc-central">Central login URL</label>
          <Input
            id="oidc-central"
            disabled={!!status.primaryUrl}
            type="url"
            required
            value={config.centralOrigin}
            onInput={(event) =>
              edit({ centralOrigin: event.currentTarget.value })
            }
          />
          <p class="sb-help-text">
            {status.primaryUrl
              ? "Uses the primary URL configured under Admin → Server."
              : "Use the public HTTPS origin configured for central login on this server."}
          </p>
          <label for="oidc-issuer">Issuer URL</label>
          <Input
            id="oidc-issuer"
            type="url"
            required
            readOnly={providerMode === "google"}
            value={config.issuer}
            onInput={(event) => edit({ issuer: event.currentTarget.value })}
          />
          {providerMode === "google" ? (
            <p class="sb-help-text">
              Create a Web application OAuth client in Google Cloud and add the
              callback below as an authorized redirect URI. Configure the
              consent screen for your Workspace organization.
            </p>
          ) : (
            <p class="sb-help-text">
              Create a confidential OIDC client using Authorization Code with
              PKCE and the openid, email, and profile scopes. Register this
              exact callback URL.
            </p>
          )}
          <label for="oidc-callback">Callback URL</label>
          <Input id="oidc-callback" readOnly value={callbackUrl} />
          <div class="row">
            <Button
              onClick={async () => {
                try {
                  await copyToClipboard(callbackUrl);
                  setCopied(true);
                } catch {
                  setError(
                    "Copy failed. Select and copy the callback URL above.",
                  );
                }
              }}
            >
              Copy callback URL
            </Button>
            {copied && <span role="status">Copied.</span>}
          </div>
          <label for="oidc-client">Client ID</label>
          <Input
            id="oidc-client"
            required
            value={config.clientId}
            onInput={(event) => edit({ clientId: event.currentTarget.value })}
          />
          <label for="oidc-secret">Client secret</label>
          <Input
            id="oidc-secret"
            type="password"
            autoComplete="new-password"
            required={!config.hasClientSecret}
            placeholder={
              config.hasClientSecret
                ? "Saved secret — leave blank to keep"
                : undefined
            }
            value={config.clientSecret ?? ""}
            onInput={(event) =>
              edit({ clientSecret: event.currentTarget.value })
            }
          />
          {providerMode === "google" && (
            <>
              <label for="oidc-domain">Workspace domain</label>
              <Input
                id="oidc-domain"
                required
                placeholder="example.test"
                value={config.workspaceDomain ?? ""}
                onInput={(event) =>
                  edit({ workspaceDomain: event.currentTarget.value })
                }
              />
              <p class="sb-help-text">
                Sign-in requires this verified Google Workspace organization.
              </p>
            </>
          )}
          <label for="oidc-label">Sign-in button label</label>
          <Input
            id="oidc-label"
            required
            value={config.buttonLabel}
            onInput={(event) =>
              edit({ buttonLabel: event.currentTarget.value })
            }
          />
          <div class="row">
            <Button type="submit" variant="primary">
              {busy ? "Saving…" : "Save and test sign-in"}
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </fieldset>
      </form>
      {result?.status === "running" && (
        <div>
          <p role="status">
            Complete sign-in in the test window. Your administrator session
            stays signed in.
          </p>
          {testUrl && (
            <p>
              <Button
                onClick={() => {
                  popup.current?.close();
                  popup.current = window.open(
                    testUrl,
                    "_blank",
                    "popup,width=600,height=720",
                  );
                }}
              >
                Open sign-in test window
              </Button>
            </p>
          )}
          <Button
            onClick={() => {
              popup.current?.close();
              setTestId(undefined);
              setResult(undefined);
              setTestUrl("");
              testProof.current = undefined;
            }}
          >
            Cancel test
          </Button>
        </div>
      )}
      {result?.status === "error" && (
        <Alert variant="error">
          {result.error ||
            "The provider test failed. Check the settings and try again."}
        </Alert>
      )}
      {result?.status === "success" && (
        <section aria-label="Review provider">
          <h2>Review and enable</h2>
          <p>The saved configuration passed its sign-in test.</p>
          <dl>
            <dt>Central login</dt>
            <dd>{config.centralOrigin}</dd>
            <dt>Sign-in button</dt>
            <dd>{config.buttonLabel}</dd>
            {result.email && (
              <>
                <dt>Test identity</dt>
                <dd>{result.email}</dd>
              </>
            )}
            {result.emailVerified !== undefined && (
              <>
                <dt>Email verified</dt>
                <dd>{result.emailVerified ? "Yes" : "No"}</dd>
              </>
            )}
            {result.admissionAllowed !== undefined && (
              <>
                <dt>Organization policy</dt>
                <dd>{result.admissionAllowed ? "Passed" : "Not permitted"}</dd>
              </>
            )}
            {result.provisionedUsername !== undefined && (
              <>
                <dt>Provisioned account</dt>
                <dd>{result.provisionedUsername ?? "No account added yet"}</dd>
              </>
            )}
            {providerMode === "google" && (
              <>
                <dt>Workspace domain</dt>
                <dd>{config.workspaceDomain}</dd>
              </>
            )}
          </dl>
          <p>Only accounts added by an administrator can sign in.</p>
          {replacement && (
            <label>
              <Checkbox
                checked={replace}
                onChange={(event) => setReplace(event.currentTarget.checked)}
              />
              Replace the connected provider and revoke its SSO browser
              sessions. Existing accounts will need explicit identity review.
            </label>
          )}
          <div class="row">
            <Button
              variant="primary"
              disabled={
                busy || revision === undefined || (replacement && !replace)
              }
              onClick={() => {
                void activate();
              }}
            >
              Enable SSO
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
