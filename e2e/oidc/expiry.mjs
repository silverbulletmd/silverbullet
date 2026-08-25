// State-cookie TTL check: captures a real sb_oidc_state cookie via
// /.oidc/login, waits past the 600 s TTL, then replays it at /.oidc/callback
// expecting the oidc_error bounce.
//
// Usage:
//   node e2e/oidc/expiry.mjs [provider] [--wait <seconds>]
// `--wait` defaults to 615 (TTL 600 + margin). Use a small value with an SB
// build whose TTL was lowered for testing.
import { cookiesOf, resolveProvider, SB_BASE } from "./env.mjs";

resolveProvider(process.argv[2] ?? "dex"); // validates the provider name
const waitIdx = process.argv.indexOf("--wait");
const waitSeconds = waitIdx !== -1 ? Number(process.argv[waitIdx + 1]) : 615;
const STATE_COOKIE = "sb_oidc_state";

const login = await fetch(`${SB_BASE}/.oidc/login?return=/`, {
  redirect: "manual",
});
const cookies = cookiesOf(login);
const cookie = cookies[STATE_COOKIE];
if (!cookie) {
  console.error("FAIL: /.oidc/login issued no state cookie");
  process.exit(1);
}
console.log(
  `captured state cookie (${cookie.length} chars); sleeping ${waitSeconds}s...`,
);
await new Promise((r) => setTimeout(r, waitSeconds * 1000));

const res = await fetch(`${SB_BASE}/.oidc/callback?code=fake&state=fakestate`, {
  redirect: "manual",
  headers: { Cookie: `${STATE_COOKIE}=${cookie}` },
});
const loc = res.headers.get("location");
const pass = res.status === 302 && (loc ?? "").includes("oidc_error=1");
console.log(`after ${waitSeconds}s: ${res.status} -> ${loc}`);
console.log(
  pass ? "PASS: expired state rejected" : "FAIL: expired state accepted?",
);
process.exit(pass ? 0 : 1);
