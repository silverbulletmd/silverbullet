import { beforeEach, expect, test, vi } from "vitest";

const proxyFetch = vi.hoisted(() => vi.fn());
vi.mock("../../space_lua/stdlib/net.ts", () => ({ proxyFetch }));

import { oauthSyscalls } from "./oauth.ts";

const opts = {
  deviceCodeUrl: "https://github.com/login/device/code",
  tokenUrl: "https://github.com/login/oauth/access_token",
  clientId: "abc",
  scope: "repo gist",
};

function ok(body: any) {
  return { status: 200, ok: true, headers: {}, body };
}

function setup() {
  const close = vi.fn();
  let onCancel = () => {};
  const showDeviceCode = vi.fn((_code: unknown, cancel: () => void) => {
    onCancel = cancel;
    return close;
  });
  const cancel = () => onCancel();
  const client = { ui: { showDeviceCode } } as any;
  const fn = (oauthSyscalls(client)["oauth.deviceFlow"] as any).callback;
  return { fn, showDeviceCode, close, cancel };
}

beforeEach(() => {
  vi.stubGlobal("location", { host: "localhost:3000" });
  proxyFetch.mockReset();
});

test("oauth.deviceFlow wires proxyFetch, timers and the UI", async () => {
  proxyFetch
    .mockResolvedValueOnce(
      ok({
        device_code: "dc",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      }),
    )
    .mockResolvedValueOnce(ok({ access_token: "tok", token_type: "bearer" }));
  const { fn, showDeviceCode, close } = setup();
  const token = await fn({}, opts);
  expect(token).toEqual({ access_token: "tok", token_type: "bearer" });
  expect(showDeviceCode).toHaveBeenCalledWith(
    expect.objectContaining({ userCode: "ABCD-1234" }),
    expect.any(Function),
  );
  expect(close).toHaveBeenCalled();
});

test("oauth.deviceFlow rejects with 'cancelled:' when the user cancels", async () => {
  proxyFetch.mockResolvedValueOnce(
    ok({
      device_code: "dc",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 1,
    }),
  );
  proxyFetch.mockResolvedValue(ok({ error: "authorization_pending" }));
  const { fn, cancel } = setup();
  const p = fn({}, opts);
  setTimeout(cancel, 10);
  await expect(p).rejects.toThrow(/^cancelled:/);
});

test("oauth.deviceFlow prefixes non-flow errors with 'failed:'", async () => {
  proxyFetch.mockRejectedValueOnce(new Error("network down"));
  const { fn } = setup();
  await expect(fn({}, opts)).rejects.toThrow(/^failed: network down/);
});
