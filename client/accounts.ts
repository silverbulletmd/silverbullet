import type { Client } from "./client.ts";
import { fsEndpoint } from "./spaces/constants.ts";
import type { Account, ClientProfile } from "../plug-api/types/profile.ts";

export type { Account, ClientProfile };

/** Deployments without accounts (the App, a single-user server) report no
 * username at all. `me` is the name you always have. */
export const ANONYMOUS_USERNAME = "me";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function accountsFrom(response: unknown): Account[] {
  if (!Array.isArray(response)) {
    return [];
  }
  return response.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const account: Account = {
      username: text(entry.username) ?? null,
      me: entry.me === true,
    };
    const fullName = text(entry.fullName);
    if (fullName) account.fullName = fullName;
    return account;
  });
}

/** The caller's identity. A deployment with no accounts still has a person
 * behind it, so their name survives here even though they are nobody the
 * space can address. */
export function ownProfile(accounts: Account[]): ClientProfile {
  const own = accounts.find((account) => account.me);
  if (!own) {
    return { username: ANONYMOUS_USERNAME };
  }
  const profile: ClientProfile = {
    username: own.username ?? ANONYMOUS_USERNAME,
  };
  if (own.fullName) profile.fullName = own.fullName;
  return profile;
}

export function profileFrom(response: unknown): ClientProfile {
  return ownProfile(accountsFrom(response));
}

let cached: Promise<Account[]> | undefined;
let retryAfter = 0;

/** A failure is worth retrying -- a deployment whose accounts endpoint is
 * missing or briefly unreachable should recover without a reload -- but not
 * on every call: callers include per-refresh view sources, and an endpoint
 * that keeps failing would otherwise be re-fetched several times a second. */
const RETRY_COOLDOWN_MS = 30000;

export function loadAccounts(client: Client): Promise<Account[]> {
  if (!cached) {
    if (Date.now() < retryAfter) {
      return Promise.resolve([]);
    }
    cached = fetchAccounts(client).then(
      (accounts) => accounts,
      (e) => {
        console.warn("Could not load accounts", e);
        cached = undefined;
        retryAfter = Date.now() + RETRY_COOLDOWN_MS;
        return [];
      },
    );
  }
  return cached;
}

export async function loadProfile(client: Client): Promise<ClientProfile> {
  return ownProfile(await loadAccounts(client));
}

async function fetchAccounts(client: Client): Promise<Account[]> {
  const base = client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length);
  const resp = await client.httpSpacePrimitives.authenticatedFetch(
    `${base}/.accounts`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  if (!resp.ok) {
    throw new Error(`Accounts request failed: ${resp.status}`);
  }
  return accountsFrom(await resp.json());
}
