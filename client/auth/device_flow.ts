import type {
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../plugos/proxy_fetch.ts";

export type DeviceFlowOptions = {
  deviceCodeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope?: string;
  deviceName?: string;
};

export type DeviceCode = {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
};

export type DeviceFlowDeps = {
  fetch: (
    url: string,
    options: ProxyFetchRequest,
  ) => Promise<ProxyFetchResponse>;
  /** Rejects when the signal aborts */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number; // ms
  /** Shows the code until the returned close is called; cancel aborts */
  showCode: (code: DeviceCode, cancel: () => void) => () => void;
};

export class DeviceFlowError extends Error {
  constructor(
    public reason: "cancelled" | "expired" | "denied" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

const defaultIntervalSeconds = 5;
const grantType = "urn:ietf:params:oauth:grant-type:device_code";

function formRequest(params: Record<string, string | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) body.set(k, v);
  }
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  } as ProxyFetchRequest;
}

// Upstream bodies are normally already parsed, but fall back to parsing text.
function jsonBody(resp: ProxyFetchResponse): Record<string, any> | undefined {
  let body: unknown = resp.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  return body && typeof body === "object" ? (body as Record<string, any>) : {};
}

// The verification URIs are shown as links, so only allow web URLs
function webUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function invalidResponse(field: string): never {
  throw new DeviceFlowError(
    "failed",
    `Invalid device code response: bad or missing ${field}`,
  );
}

export async function runDeviceFlow(
  opts: DeviceFlowOptions,
  deps: DeviceFlowDeps,
): Promise<Record<string, unknown>> {
  const codeResp = await deps.fetch(
    opts.deviceCodeUrl,
    formRequest({
      client_id: opts.clientId,
      scope: opts.scope,
      device_name: opts.deviceName,
    }),
  );
  const codeBody = jsonBody(codeResp);
  if (codeResp.status !== 200 || !codeBody || codeBody.error) {
    const detail = codeBody?.error
      ? String(codeBody.error)
      : typeof codeResp.body === "string"
        ? codeResp.body
        : "";
    throw new DeviceFlowError(
      "failed",
      `Device code request failed (HTTP ${codeResp.status})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  if (!codeBody.device_code) invalidResponse("device_code");
  if (!codeBody.user_code) invalidResponse("user_code");
  const verificationUri =
    webUrl(codeBody.verification_uri) ?? invalidResponse("verification_uri");
  const verificationUriComplete =
    codeBody.verification_uri_complete == null
      ? undefined
      : (webUrl(codeBody.verification_uri_complete) ??
        invalidResponse("verification_uri_complete"));

  const expiresIn = Number(codeBody.expires_in) || 900;
  let intervalMs = (Number(codeBody.interval) || defaultIntervalSeconds) * 1000;
  const deadline = deps.now() + expiresIn * 1000;
  const deviceCode = String(codeBody.device_code);

  const cancellation = new AbortController();
  const { signal } = cancellation;
  const close = deps.showCode(
    {
      userCode: String(codeBody.user_code),
      verificationUri,
      verificationUriComplete,
      expiresIn,
    },
    () => cancellation.abort(),
  );

  try {
    while (true) {
      await deps.sleep(intervalMs, signal);
      if (deps.now() >= deadline) {
        throw new DeviceFlowError("expired", "The sign-in code expired");
      }
      const resp = await deps.fetch(
        opts.tokenUrl,
        formRequest({
          client_id: opts.clientId,
          device_code: deviceCode,
          grant_type: grantType,
        }),
      );
      // Cancelled while the request was underway
      signal.throwIfAborted();
      const body = jsonBody(resp);
      // OAuth errors are in the JSON body; the status varies by server
      // (GitHub: 200, SilverBullet: 400).
      const error = body?.error;
      if (!error) {
        if (resp.status === 200 && body?.access_token) return body;
        throw new DeviceFlowError(
          "failed",
          `Token request failed (HTTP ${resp.status})`,
        );
      }
      switch (error) {
        case "authorization_pending":
          break;
        case "slow_down":
          intervalMs += 5000;
          break;
        case "expired_token":
          throw new DeviceFlowError("expired", "The sign-in code expired");
        case "access_denied":
          throw new DeviceFlowError("denied", "Access was denied");
        default:
          throw new DeviceFlowError(
            "failed",
            `Token request failed: ${error}${
              body.error_description ? ` (${body.error_description})` : ""
            }`,
          );
      }
    }
  } catch (e) {
    if (signal.aborted) {
      throw new DeviceFlowError("cancelled", "Sign-in cancelled");
    }
    throw e;
  } finally {
    close();
  }
}
