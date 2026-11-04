import { createHash, randomBytes } from "node:crypto";
import { adminApi, test } from "../fixtures/authenticated.ts";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  expect,
  getFreePort,
} from "../fixtures/core.ts";

test.skip(
  !!process.env.SB_E2E_HOST,
  "MCP loopback redirects are not part of LAN HTTP mode.",
);

const base64url = (bytes: Buffer) => bytes.toString("base64url");

async function mcpHelp(origin: string, token: string) {
  const response = await fetch(`${origin}/.mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "help", arguments: {} },
    }),
  });
  return {
    status: response.status,
    text: response.ok ? await response.text() : "",
  };
}

test("an MCP client is connected to the ticked spaces only, then revoked", async ({
  adminPage: page,
  sbServer,
}) => {
  const origin = sbServer.url;
  await adminApi(page, sbServer, "PUT", "server-config", { mcp: true });
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Garden",
    binding: { prefix: "/garden" },
  });
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Recipes",
    binding: { prefix: "/recipes" },
  });
  await page.context().clearCookies();

  const redirectUri = `http://127.0.0.1:${await getFreePort()}/callback`;
  const registration = await fetch(`${origin}/.auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Self-registered app",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json();

  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(12));
  const authorizeUrl = `${origin}/.auth/mcp/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "mcp",
    resource: `${origin}/.mcp`,
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  })}`;

  await page.goto(authorizeUrl);
  await expect(page).toHaveURL(/\/\.dashboard\/login\?next=/);
  await page.getByLabel("Username", { exact: true }).fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  const consent = page.locator("main");
  await expect(consent).toContainText("Self-registered app");
  await expect(consent).toContainText("It will return to this computer");
  await expect(page.getByLabel("Garden")).toBeChecked();
  await page.getByLabel("Recipes").uncheck();

  const callback = page.waitForRequest((request) =>
    request.url().startsWith(redirectUri),
  );
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const returned = new URL((await callback).url());
  const code = returned.searchParams.get("code");
  expect(code).toBeTruthy();
  expect(returned.searchParams.get("state")).toBe(state);
  expect(returned.searchParams.get("iss")).toBe(origin);

  const exchange = await fetch(`${origin}/.auth/mcp/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
      resource: `${origin}/.mcp`,
    }),
  });
  expect(exchange.status).toBe(200);
  const { access_token: token } = await exchange.json();

  const help = await mcpHelp(origin, token);
  expect(help.status).toBe(200);
  expect(help.text).toContain("| Space | id | Runtime |");
  expect(help.text).toContain("Garden");
  expect(help.text).not.toContain("manual");
  expect(help.text).not.toContain("Recipes");

  await page.goto(`${origin}/.dashboard/profile`);
  const row = page.getByRole("row", { name: /Self-registered app/ });
  await expect(row).toContainText("Garden");
  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("No apps are connected.")).toBeVisible();
  expect((await mcpHelp(origin, token)).status).toBe(401);
});
