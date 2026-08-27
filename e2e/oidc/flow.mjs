// SB-mediated OIDC flow harness (success, replay and malformed-callback paths).
//
// Starts at SB /.oidc/login (so the signed state cookie is issued), drives the
// provider login via Playwright, intercepts the callback URL, then replays it
// against SB with plain fetch to exercise success/error/replay paths.
//
// Usage:
//   node e2e/oidc/flow.mjs <provider> [mode] [args...]
//   node e2e/oidc/flow.mjs dex happy /my-space/
//   node e2e/oidc/flow.mjs dex sanitize
//   node e2e/oidc/flow.mjs dex errors
import { chromium } from "playwright";
import {
  chromiumLaunchOptions,
  cookiesOf,
  resolveProvider,
  SB_BASE,
} from "./env.mjs";

const provider = resolveProvider(process.argv[2] ?? "dex");
const mode = process.argv[3] ?? "happy";
const STATE_COOKIE = "sb_oidc_state";

async function startLogin(returnMount = "") {
  const url = `${SB_BASE}/.oidc/login${returnMount ? `?return=${encodeURIComponent(returnMount)}` : ""}`;
  const res = await fetch(url, { redirect: "manual" });
  return {
    location: res.headers.get("location"),
    status: res.status,
    cookies: cookiesOf(res),
  };
}

/** Warm-browser variant: drive the provider once, capturing the callback URL.
 *
 * Deliberately NOT seeded with the state cookie: the browser will inevitably
 * follow the provider's redirect into SB's callback (context routes cannot
 * stop main-frame navigation), and without the cookie SB rejects that hit
 * before exchanging the code — leaving the code valid for the fetch replay
 * the caller performs with `hitCallback`. With the cookie present the
 * browser-side hit would consume the code and the replay would 400.
 */
async function driveProvider(authorizeUrl) {
  const b = await chromium.launch(chromiumLaunchOptions());
  const ctx = await b.newContext();
  let callbackUrl = null;
  ctx.on("response", (r) => {
    const loc = r.headers().location || "";
    const candidate = loc.includes("/.oidc/callback") ? loc : r.url();
    if (
      (r.status() === 302 || r.status() === 303) &&
      candidate.includes("/.oidc/callback")
    ) {
      callbackUrl ??= new URL(candidate, r.url()).toString();
    }
  });
  // Subresource requests to the callback host are aborted; the main-frame
  // redirect still lands on SB's callback (routes can't stop navigation),
  // but — see the doc above — that hit is cookie-less and pre-exchange.
  await ctx.route(
    (u) =>
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.port === "3000",
    (route) => route.abort(),
  );
  const page = await ctx.newPage();
  await page.goto(authorizeUrl, { waitUntil: "networkidle" });
  await page.fill(provider.userSelector, provider.user);
  await page.fill(provider.passwordSelector, provider.password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.click(provider.submitSelector),
  ]);
  for (let i = 0; i < 40 && !callbackUrl; i++) await page.waitForTimeout(250);
  await b.close();
  return { callbackUrl };
}

function parseCallback(cbUrl) {
  return Object.fromEntries(new URL(cbUrl).searchParams);
}

async function hitCallback(code, state, stateCookie) {
  const res = await fetch(
    `${SB_BASE}/.oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    {
      redirect: "manual",
      headers: stateCookie ? { Cookie: `${STATE_COOKIE}=${stateCookie}` } : {},
    },
  );
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookie: res.headers.getSetCookie(),
  };
}

/** The `username` claim of the session JWT in a callback's Set-Cookie list. */
function jwtUsername(setCookie) {
  const c = (setCookie ?? []).find((s) => s.startsWith("auth_"));
  if (!c) return null;
  try {
    const token = c.split(";")[0].slice(c.indexOf("=") + 1);
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (
      JSON.parse(Buffer.from(payload, "base64").toString()).username ?? null
    );
  } catch {
    return null;
  }
}

let failures = 0;
function check(label, cond, extra = "") {
  if (!cond) failures++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
}

if (mode === "happy") {
  const returnMount = process.argv[4] ?? "/";
  const t0 = Date.now();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const ctx = await browser.newContext();
  let cbCap = null;
  ctx.on("response", (r) => {
    const loc = r.headers().location || "";
    const candidate = loc.includes("/.oidc/callback") ? loc : r.url();
    if (
      (r.status() === 302 || r.status() === 303) &&
      candidate.includes("/.oidc/callback")
    ) {
      cbCap = new URL(candidate, r.url()).toString();
    }
  });
  await ctx.route(
    (u) =>
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.port === "3000",
    (route) => route.abort(),
  );
  const { location, cookies } = await startLogin(returnMount);
  check(
    "startLogin issues state cookie",
    !!location && !!cookies[STATE_COOKIE],
  );
  if (!location || !cookies[STATE_COOKIE]) process.exit(1);
  console.log(
    JSON.stringify({ step: "startLogin", status: "ok", returnMount }),
  );
  const page = await ctx.newPage();
  await page.goto(location, { waitUntil: "networkidle" });
  await page.fill(provider.userSelector, provider.user);
  await page.fill(provider.passwordSelector, provider.password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.click(provider.submitSelector),
  ]);
  for (let i = 0; i < 40 && !cbCap; i++) await page.waitForTimeout(250);
  console.error(`[timing] total pre-exchange: ${Date.now() - t0}ms`);
  await browser.close();
  if (!cbCap) {
    check("provider returns callback", false);
    process.exit(1);
  }
  const q = parseCallback(cbCap);
  check(
    "callback carries code + echoed state",
    !!q.code && q.state !== undefined,
  );

  const r1 = await hitCallback(q.code, q.state, cookies[STATE_COOKIE]);
  check(
    `callback#1 → 302 ${returnMount}`,
    r1.status === 302 && r1.location === returnMount,
    `(got ${r1.status} -> ${r1.location})`,
  );
  check(
    "session issued",
    r1.setCookie.some((c) => c.startsWith("auth_")),
  );
  check(
    "state cookie cleared",
    r1.setCookie.some((c) =>
      new RegExp(`${STATE_COOKIE}=;|Max-Age=0`, "i").test(c),
    ),
  );

  // Replay of the same auth code must bounce to the login error screen.
  const r2 = await hitCallback(q.code, q.state, cookies[STATE_COOKIE]);
  check(
    "replay rejected → oidc_error",
    r2.status === 302 && (r2.location ?? "").includes("oidc_error=1"),
    `(got ${r2.status} -> ${r2.location})`,
  );

  // Re-login: the same provider identity must resolve back to the account
  // linked on the first login, not provision a duplicate.
  const { location: loc2, cookies: cookies2 } = await startLogin(returnMount);
  check(
    "re-login: startLogin issues state cookie",
    !!loc2 && !!cookies2[STATE_COOKIE],
  );
  let r3 = null;
  if (loc2 && cookies2[STATE_COOKIE]) {
    const { callbackUrl: cb2 } = await driveProvider(loc2);
    check("re-login: provider returns callback", !!cb2);
    if (cb2) {
      const q2 = parseCallback(cb2);
      r3 = await hitCallback(q2.code, q2.state, cookies2[STATE_COOKIE]);
      check(
        `re-login: callback → 302 ${returnMount}`,
        r3.status === 302 && r3.location === returnMount,
        `(got ${r3.status} -> ${r3.location})`,
      );
    }
  }
  const u1 = jwtUsername(r1.setCookie);
  const u2 = r3 ? jwtUsername(r3.setCookie) : null;
  check(
    "re-login: same account resolved (no duplicate provision)",
    !!u1 && u1 === u2,
    `(first=${u1} second=${u2})`,
  );
} else if (mode === "sanitize") {
  // Malicious return mounts must sanitize to /.
  const cases = [
    "/test",
    "/",
    "/valid/path",
    "//evil.com",
    "javascript:alert(1)",
    "http://evil.com",
    "evil",
  ];
  for (const ret of cases) {
    const { location, cookies } = await startLogin(ret);
    if (!location || !cookies[STATE_COOKIE]) {
      check(`${ret}: startLogin`, false);
      continue;
    }
    const { callbackUrl } = await driveProvider(location);
    if (!callbackUrl) {
      check(`${ret}: provider callback`, false);
      continue;
    }
    const q = parseCallback(callbackUrl);
    const r = await hitCallback(q.code, q.state, cookies[STATE_COOKIE]);
    const expected =
      ret.startsWith("/") && !ret.startsWith("//") && !ret.includes("://")
        ? ret
        : "/";
    check(
      `return ${ret} → ${expected}`,
      r.location === expected,
      `(got ${r.location})`,
    );
  }
} else if (mode === "errors") {
  // Malformed callback requests all land on oidc_error.
  const { cookies } = await startLogin("/");
  const sc = cookies[STATE_COOKIE];
  const show = async (label, qs, cookie) => {
    const res = await fetch(`${SB_BASE}/.oidc/callback?${qs}`, {
      redirect: "manual",
      headers: cookie ? { Cookie: cookie } : {},
    });
    const loc = res.headers.get("location");
    check(
      label,
      res.status === 302 && (loc ?? "").includes("oidc_error=1"),
      `(got ${res.status} -> ${loc})`,
    );
  };
  await show("missing code", "state=x", `${STATE_COOKIE}=${sc}`);
  await show("missing state", "code=fake", `${STATE_COOKIE}=${sc}`);
  await show("no state cookie", "code=fake&state=y", null);
  const tampered =
    sc.length > 10
      ? sc.startsWith("v1:")
        ? `v1:X${sc.slice(3)}`
        : `X${sc.slice(1)}`
      : "garbage";
  await show(
    "tampered HMAC",
    "code=fake&state=z",
    `${STATE_COOKIE}=${tampered}`,
  );
} else {
  console.error("Unknown mode:", mode);
  process.exit(1);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
