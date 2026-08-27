// ID-token claim inspection: drives the provider login headlessly, captures
// the authorization code, exchanges it directly at the token endpoint and
// prints the decoded claims. SilverBullet itself is never contacted.
//
// Usage:
//   node e2e/oidc/claims.mjs <provider>
import { chromium } from "playwright";
import { chromiumLaunchOptions, resolveProvider, SB_BASE } from "./env.mjs";

const provider = resolveProvider(process.argv[2] ?? "dex");
const REDIRECT = `${SB_BASE}/.oidc/callback`;

const cfg = await (
  await fetch(`${provider.issuer}/.well-known/openid-configuration`)
).json();

const state = `inspect-${Date.now()}`;
const nonce = `nonce-${Date.now()}`;
const authUrl = new URL(cfg.authorization_endpoint);
for (const [k, v] of Object.entries({
  client_id: provider.clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: "openid profile email",
  state,
  nonce,
}))
  authUrl.searchParams.set(k, v);

const browser = await chromium.launch(chromiumLaunchOptions());
const ctx = await browser.newContext();
let callbackUrl = null;
const setCb = (u) => {
  try {
    const p = new URL(u);
    if (
      (p.hostname === "localhost" || p.hostname === "127.0.0.1") &&
      p.pathname === "/.oidc/callback"
    ) {
      callbackUrl ??= u;
    }
  } catch {}
};
// Primary capture: Location header of the provider's 302/303 back to us.
ctx.on("response", (r) => {
  if (r.status() === 302 || r.status() === 303)
    setCb(r.headers().location ?? "");
});
// Backstop: block only the SB callback host (localhost:3000), not the IdP
// (e.g. Dex at localhost:5556), so the login form can load.
await ctx.route(
  (u) =>
    (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
    u.port === "3000",
  (route) => {
    setCb(route.request().url());
    return route.abort();
  },
);
const page = await ctx.newPage();
await page.goto(authUrl.toString(), { waitUntil: "networkidle" });
await page.fill(provider.userSelector, provider.user);
await page.fill(provider.passwordSelector, provider.password);
await Promise.all([
  page.waitForLoadState("networkidle").catch(() => {}),
  page.click(provider.submitSelector),
]);
for (let i = 0; i < 40 && !callbackUrl; i++) await page.waitForTimeout(250);
if (!callbackUrl) {
  console.error("final url:", page.url());
  console.error("No callback captured — login may have failed.");
  await browser.close();
  process.exit(1);
}
await browser.close();

const qs = Object.fromEntries(new URL(callbackUrl).searchParams);
if (!qs.code) throw new Error(`callback had no code: ${callbackUrl}`);
if (qs.state !== state)
  throw new Error(`state mismatch: ${qs.state} != ${state}`);

const basic = Buffer.from(
  `${provider.clientId}:${provider.clientSecret}`,
).toString("base64");
const tokRes = await fetch(cfg.token_endpoint, {
  method: "POST",
  headers: {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: qs.code,
    redirect_uri: REDIRECT,
  }),
});
const tokens = await tokRes.json();
if (!tokens.id_token)
  throw new Error(`token exchange failed: ${JSON.stringify(tokens)}`);

const claims = JSON.parse(
  Buffer.from(tokens.id_token.split(".")[1], "base64url").toString(),
);
console.log("=== ID token claims ===");
console.log(JSON.stringify(claims, null, 2));
console.log("\n=== checks ===");
console.log(
  "issuer match:",
  claims.iss === provider.issuer ||
    claims.iss === provider.issuer.replace(/\/$/, ""),
);
console.log("aud is client_id:", claims.aud === provider.clientId);
console.log("nonce echoed:", claims.nonce === nonce);
console.log("subject:", JSON.stringify(claims.sub));
for (const c of ["preferred_username", "name", "email"]) {
  console.log(`${c}:`, JSON.stringify(claims[c]));
}

if (cfg.userinfo_endpoint && tokens.access_token) {
  const ui = await (
    await fetch(cfg.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
  ).json();
  console.log("\n=== userinfo ===");
  console.log(JSON.stringify(ui, null, 2));
}
