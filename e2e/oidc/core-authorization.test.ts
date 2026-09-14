import { createHash } from "node:crypto";
import http from "node:http";
import { expect, test } from "@playwright/test";
import {
  type CoreOidcFixture,
  coreApi,
  newPocketUserPage,
  signInWithPocketId,
  startCoreOidcFixture,
} from "./core-fixture.ts";

type AuthenticationStatus = {
  active: { providerId: string };
};

type CoreResponse = {
  body: string;
  status: number;
};

type DeviceTokens = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  username: string;
};

function coreRequest(
  fixture: CoreOidcFixture,
  origin: string,
  path: string,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<CoreResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: fixture.corePort,
        path,
        method: options.method ?? "GET",
        headers: {
          Host: new URL(origin).host,
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString(),
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function postForm(
  fixture: CoreOidcFixture,
  origin: string,
  path: string,
  form: URLSearchParams,
): Promise<CoreResponse> {
  const body = form.toString();
  return coreRequest(fixture, origin, path, {
    method: "POST",
    body,
    headers: {
      "Content-Length": String(Buffer.byteLength(body)),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
}

test.describe.configure({ timeout: 300_000 });

test("SSO continues App authorization and browser logout preserves device credentials", async ({
  browserName: _browserName,
}, testInfo) => {
  testInfo.setTimeout(300_000);
  let fixture: CoreOidcFixture | undefined;
  let callbackServer: http.Server | undefined;
  try {
    fixture = await startCoreOidcFixture();
    const provider = await coreApi<AuthenticationStatus>(
      fixture.adminPage,
      "GET",
      "admin/authentication",
    );
    await coreApi(fixture.adminPage, "POST", "admin/users", {
      username: "river",
      loginMethod: "sso",
      providerId: provider.active.providerId,
      expectedEmail: "fixture-user@example.test",
      admin: false,
    });
    await coreApi(fixture.adminPage, "POST", "admin/spaces", {
      name: "Notes",
      binding: { host: new URL(fixture.oidc.notesOrigin).host },
      members: { river: {} },
      seedIndex: true,
    });

    let resolveCallback: (url: URL) => void;
    const callback = new Promise<URL>((resolve) => {
      resolveCallback = resolve;
    });
    callbackServer = http.createServer((request, response) => {
      resolveCallback(new URL(request.url ?? "/", "http://127.0.0.1"));
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("Authorization complete");
    });
    await new Promise<void>((resolve) =>
      callbackServer!.listen(0, "127.0.0.1", resolve),
    );
    const callbackAddress = callbackServer.address();
    if (!callbackAddress || typeof callbackAddress === "string") {
      throw new Error("Loopback callback listener did not start");
    }
    const redirectUri = `http://127.0.0.1:${callbackAddress.port}/callback`;
    const verifier = "silverbullet-app-pkce-verifier-0123456789";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = "app-flow-state";
    const params = new URLSearchParams({
      client_id: "silverbullet-app",
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      device_name: "Morgan's laptop",
    });

    const user = await newPocketUserPage(fixture);
    try {
      await user.page.goto(
        `${fixture.oidc.notesOrigin}/.auth/authorize?${params}`,
      );
      await expect(
        user.page.getByRole("button", {
          name: "Sign in with Pocket ID",
          exact: true,
        }),
      ).toBeVisible();
      await signInWithPocketId(user.page);
      await expect(
        user.page.getByRole("heading", {
          name: "Authorize access",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        user.page.getByText("Morgan's laptop", { exact: true }),
      ).toBeVisible();
      await user.page
        .getByRole("button", { name: "Approve", exact: true })
        .click();

      const callbackUrl = await callback;
      expect(callbackUrl.searchParams.get("state")).toBe(state);
      const code = callbackUrl.searchParams.get("code");
      expect(code).not.toBeNull();
      const tokenResponse = await postForm(
        fixture,
        fixture.oidc.notesOrigin,
        "/.auth/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code: code!,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: "silverbullet-app",
        }),
      );
      expect(tokenResponse.status).toBe(200);
      const tokens = JSON.parse(tokenResponse.body) as DeviceTokens;
      expect(tokens).toMatchObject({
        token_type: "Bearer",
        username: "river",
      });

      const deviceAccess = await coreRequest(
        fixture,
        fixture.oidc.notesOrigin,
        "/.config",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      expect(deviceAccess.status).toBe(200);

      await user.page.goto(`${fixture.oidc.notesOrigin}/?headless=1`);
      await expect(user.page.locator("#sb-editor .cm-editor")).toBeVisible();
      expect(
        await user.page.evaluate(async () => {
          const response = await fetch("/.spaces/api/logout");
          return response.status;
        }),
      ).toBe(200);
      await user.page.goto(`${fixture.oidc.notesOrigin}/?headless=1`);
      await expect(
        user.page.getByLabel("Username", { exact: true }),
      ).toBeVisible();

      const accessAfterLogout = await coreRequest(
        fixture,
        fixture.oidc.notesOrigin,
        "/.config",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      expect(accessAfterLogout.status).toBe(200);
      const refreshResponse = await postForm(
        fixture,
        fixture.oidc.notesOrigin,
        "/.auth/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: "silverbullet-app",
        }),
      );
      expect(refreshResponse.status).toBe(200);
      const refreshed = JSON.parse(refreshResponse.body) as DeviceTokens;
      expect(refreshed.username).toBe("river");
      const refreshedAccess = await coreRequest(
        fixture,
        fixture.oidc.notesOrigin,
        "/.config",
        { headers: { Authorization: `Bearer ${refreshed.access_token}` } },
      );
      expect(refreshedAccess.status).toBe(200);
    } finally {
      await user.context.close();
    }
  } catch (error) {
    if (fixture) {
      throw new Error(`${error}\nCore output:\n${fixture.output()}`);
    }
    throw error;
  } finally {
    if (callbackServer) {
      callbackServer.closeAllConnections();
      await new Promise<void>((resolve) =>
        callbackServer!.close(() => resolve()),
      );
    }
    await fixture?.stop();
  }
});
