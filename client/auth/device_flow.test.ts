import { describe, expect, it, vi } from "vitest";
import {
  type DeviceCode,
  DeviceFlowError,
  type DeviceFlowDeps,
  runDeviceFlow,
} from "./device_flow.ts";
import type { ProxyFetchResponse } from "../plugos/proxy_fetch.ts";

const opts = {
  deviceCodeUrl: "https://x.test/device",
  tokenUrl: "https://x.test/token",
  clientId: "cid",
  scope: "repo",
  deviceName: "My laptop",
};

function resp(status: number, body: unknown): ProxyFetchResponse {
  return { ok: true, status, headers: {}, body } as ProxyFetchResponse;
}

const deviceResp = (extra: Record<string, unknown> = {}) =>
  resp(200, {
    device_code: "dc",
    user_code: "ABCD-1234",
    verification_uri: "https://x.test/activate",
    expires_in: 900,
    interval: 5,
    ...extra,
  });

/** With cancelAt, the user cancels during that sleep (1-based) */
function makeDeps(
  responses: ProxyFetchResponse[],
  { cancelAt }: { cancelAt?: number } = {},
) {
  let clock = 0;
  const sleeps: number[] = [];
  const close = vi.fn();
  let cancel = () => {};
  const showCode = vi.fn((_c: DeviceCode, onCancel: () => void) => {
    cancel = onCancel;
    return close;
  });
  const fetch = vi.fn(async (_url: string, _o: any) => {
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return r;
  });
  const deps: DeviceFlowDeps = {
    fetch,
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      clock += ms;
      if (sleeps.length === cancelAt) cancel();
      signal.throwIfAborted();
    },
    now: () => clock,
    showCode,
  };
  return { deps, sleeps, close, showCode, fetch };
}

const pending = () => resp(400, { error: "authorization_pending" });

describe("runDeviceFlow", () => {
  it("returns the token after authorization_pending then success", async () => {
    const t = makeDeps([
      deviceResp(),
      pending(),
      pending(),
      resp(200, { access_token: "t" }),
    ]);
    const token = await runDeviceFlow(opts, t.deps);
    expect(token.access_token).toBe("t");
    expect(t.showCode).toHaveBeenCalledTimes(1);
    expect(t.showCode.mock.calls[0][0]).toMatchObject({
      userCode: "ABCD-1234",
      verificationUri: "https://x.test/activate",
      expiresIn: 900,
    });
    expect(t.close).toHaveBeenCalled();
  });

  it("sends urlencoded POST requests", async () => {
    const t = makeDeps([deviceResp(), resp(200, { access_token: "t" })]);
    await runDeviceFlow(opts, t.deps);
    const [url1, o1] = t.fetch.mock.calls[0];
    expect(url1).toBe(opts.deviceCodeUrl);
    expect(o1.method).toBe("POST");
    expect(o1.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(o1.headers.Accept).toBe("application/json");
    const b1 = new URLSearchParams(o1.body);
    expect(b1.get("client_id")).toBe("cid");
    expect(b1.get("scope")).toBe("repo");
    expect(b1.get("device_name")).toBe("My laptop");
    const [url2, o2] = t.fetch.mock.calls[1];
    expect(url2).toBe(opts.tokenUrl);
    const b2 = new URLSearchParams(o2.body);
    expect(b2.get("client_id")).toBe("cid");
    expect(b2.get("device_code")).toBe("dc");
    expect(b2.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
  });

  it("omits scope and device_name when not set", async () => {
    const t = makeDeps([deviceResp(), resp(200, { access_token: "t" })]);
    await runDeviceFlow(
      {
        deviceCodeUrl: opts.deviceCodeUrl,
        tokenUrl: opts.tokenUrl,
        clientId: "c",
      },
      t.deps,
    );
    const b = new URLSearchParams(t.fetch.mock.calls[0][1].body);
    expect(b.has("scope")).toBe(false);
    expect(b.has("device_name")).toBe(false);
  });

  it("slow_down increases the interval by 5 seconds", async () => {
    const t = makeDeps([
      deviceResp(),
      resp(400, { error: "slow_down" }),
      resp(200, { access_token: "t" }),
    ]);
    await runDeviceFlow(opts, t.deps);
    expect(t.sleeps).toEqual([5000, 10000]);
  });

  it('rejects with reason "cancelled" when the modal is cancelled', async () => {
    const t = makeDeps([deviceResp(), pending(), pending()], { cancelAt: 2 });
    await expect(runDeviceFlow(opts, t.deps)).rejects.toMatchObject({
      reason: "cancelled",
    });
    // The device code request and one poll, none after cancelling
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.close).toHaveBeenCalled();
  });

  it("a cancel during a poll request wins over its answer", async () => {
    const t = makeDeps([]);
    t.fetch.mockImplementationOnce(async () => deviceResp());
    t.fetch.mockImplementationOnce(async () => {
      t.showCode.mock.calls[0][1]();
      return resp(200, { access_token: "t" });
    });
    await expect(runDeviceFlow(opts, t.deps)).rejects.toMatchObject({
      reason: "cancelled",
    });
  });

  it('rejects with reason "expired" on expired_token', async () => {
    const t = makeDeps([deviceResp(), resp(400, { error: "expired_token" })]);
    await expect(runDeviceFlow(opts, t.deps)).rejects.toMatchObject({
      reason: "expired",
    });
    expect(t.close).toHaveBeenCalled();
  });

  it('rejects with reason "expired" when expiresIn elapses', async () => {
    const t = makeDeps([
      deviceResp({ expires_in: 12 }),
      pending(),
      pending(),
      pending(),
    ]);
    const err = await runDeviceFlow(opts, t.deps).catch((e) => e);
    expect(err).toBeInstanceOf(DeviceFlowError);
    expect(err.reason).toBe("expired");
  });

  it('rejects with reason "denied" on access_denied', async () => {
    const t = makeDeps([deviceResp(), resp(400, { error: "access_denied" })]);
    await expect(runDeviceFlow(opts, t.deps)).rejects.toMatchObject({
      reason: "denied",
    });
  });

  it('rejects with reason "failed" and the status on a non-200 device-code response', async () => {
    const t = makeDeps([resp(403, "Authentication not enabled")]);
    const err = await runDeviceFlow(opts, t.deps).catch((e) => e);
    expect(err.reason).toBe("failed");
    expect(err.message).toContain("403");
    expect(t.showCode).not.toHaveBeenCalled();
  });

  it("includes the OAuth error from a non-200 device-code response", async () => {
    const t = makeDeps([resp(400, { error: "unauthorized_client" })]);
    const err = await runDeviceFlow(opts, t.deps).catch((e) => e);
    expect(err.reason).toBe("failed");
    expect(err.message).toContain("unauthorized_client");
  });

  it("reads OAuth errors from the JSON body whatever the status", async () => {
    for (const status of [200, 400]) {
      const t = makeDeps([
        deviceResp(),
        resp(status, { error: "authorization_pending" }),
        resp(200, { access_token: "t" }),
      ]);
      const token = await runDeviceFlow(opts, t.deps);
      expect(token.access_token).toBe("t");
    }
  });

  it("rejects an invalid device-code response before showing it", async () => {
    const invalid: Array<[string, Record<string, unknown>]> = [
      [
        "javascript: verification_uri",
        { verification_uri: "javascript:alert(1)" },
      ],
      [
        "javascript: verification_uri_complete",
        { verification_uri_complete: "javascript:alert(1)" },
      ],
      ["malformed verification_uri", { verification_uri: "not a url" }],
      ["missing verification_uri", { verification_uri: undefined }],
      ["missing user_code", { user_code: undefined }],
      ["missing device_code", { device_code: undefined }],
    ];
    for (const [label, extra] of invalid) {
      const t = makeDeps([deviceResp(extra)]);
      const err = await runDeviceFlow(opts, t.deps).catch((e) => e);
      expect(err, label).toBeInstanceOf(DeviceFlowError);
      expect(err.reason, label).toBe("failed");
      expect(t.showCode, label).not.toHaveBeenCalled();
    }
  });

  it("accepts http and https verification URIs", async () => {
    for (const uri of [
      "http://localhost:3000/.auth/device",
      "https://x.test/a",
    ]) {
      const t = makeDeps([
        deviceResp({ verification_uri_complete: `${uri}?code=X` }),
        resp(200, { access_token: "t" }),
      ]);
      expect((await runDeviceFlow(opts, t.deps)).access_token).toBe("t");
    }
  });

  it("fails on an unknown token error", async () => {
    const t = makeDeps([deviceResp(), resp(400, { error: "server_error" })]);
    const err = await runDeviceFlow(opts, t.deps).catch((e) => e);
    expect(err.reason).toBe("failed");
    expect(err.message).toContain("server_error");
  });
});
