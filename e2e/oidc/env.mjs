// Shared configuration for the OIDC integration harness scripts.
//
// Providers:
//   dex      — local compose stack (`make test-oidc-integration` or e2e/oidc/compose-dex.yaml);
//              credentials are fixed by dex-config.yaml, no env file needed.
//   authentik— external instance; reads AUTHENTIK_* keys from test-env/.env
//              (gitignored) or the process environment.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const ENV_FILE = join(REPO_ROOT, "test-env", ".env");

/** Parse a simple KEY=VALUE env file (ignores comments/blank lines). */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

const file = loadEnvFile(ENV_FILE);
const get = (k) => process.env[k] ?? file[k];

/**
 * Resolve provider settings by name. Fills in selectors each provider's login
 * form needs so the flow scripts can drive either one.
 */
export function resolveProvider(name) {
  if (name === "dex") {
    return {
      name,
      issuer: get("DEX_ISSUER") ?? "http://localhost:5556/dex",
      clientId: get("SB_OIDC_CLIENT_ID") ?? "silverbullet",
      clientSecret: get("SB_OIDC_CLIENT_SECRET") ?? "secret",
      user: get("DEX_USER") ?? "admin@example.com",
      password: get("DEX_PASSWORD") ?? "password",
      // Dex static login form field names.
      userSelector: 'input[name="login"]',
      passwordSelector: 'input[name="password"]',
      submitSelector: 'button[type="submit"]',
    };
  }
  if (name === "authentik") {
    const issuer = get("AUTHENTIK_ISSUER");
    const clientId = get("AUTHENTIK_CLIENT_ID");
    const clientSecret = get("AUTHENTIK_CLIENT_SECRET");
    const user = get("AUTHENTIK_TEST_USER");
    const password = get("AUTHENTIK_TEST_PASSWORD");
    if (!issuer || !clientId || !clientSecret || !user || !password) {
      console.error(
        "authentik provider requires AUTHENTIK_ISSUER, AUTHENTIK_CLIENT_ID, " +
          "AUTHENTIK_CLIENT_SECRET, AUTHENTIK_TEST_USER and " +
          "AUTHENTIK_TEST_PASSWORD (set in the environment or test-env/.env)",
      );
      process.exit(1);
    }
    return {
      name,
      issuer,
      clientId,
      clientSecret,
      user,
      password,
      // Authentik flow executor field names (both naming variants seen).
      userSelector: 'input[name="uidField"], input[name="uid_field"]',
      passwordSelector: 'input[name="password"]',
      submitSelector: 'button[type="submit"]',
    };
  }
  console.error(`Unknown provider "${name}" (expected "dex" or "authentik")`);
  process.exit(1);
}

/** SilverBullet base URL under test. */
export const SB_BASE = process.env.SB_BASE_URL ?? "http://localhost:3000";

/** Browser executable override (NixOS devshells export this). */
export function chromiumLaunchOptions() {
  const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return exe ? { executablePath: exe } : {};
}

/** Extract Set-Cookie pairs from a fetch() Response into a plain object. */
export function cookiesOf(response) {
  const out = {};
  for (const c of response.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}
