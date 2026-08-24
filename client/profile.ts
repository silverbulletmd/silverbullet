import type { Client } from "./client.ts";
import { fsEndpoint } from "./spaces/constants.ts";
import type { ClientProfile } from "../plug-api/types/profile.ts";

export type { ClientProfile };

/** Deployments without accounts (the App, a single-user server) report no
 * username at all. `me` is the name you always have. */
export const ANONYMOUS_USERNAME = "me";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function profileFrom(response: unknown): ClientProfile {
  const raw = (response ?? {}) as Record<string, unknown>;
  const profile: ClientProfile = {
    username: text(raw.username) ?? ANONYMOUS_USERNAME,
  };
  const fullName = text(raw.fullName);
  if (fullName) profile.fullName = fullName;
  const email = text(raw.email);
  if (email) profile.email = email;
  return profile;
}

let cached: Promise<ClientProfile> | undefined;

export function loadProfile(client: Client): Promise<ClientProfile> {
  if (!cached) {
    cached = fetchProfile(client).then(
      (profile) => profile,
      (e) => {
        console.warn("Could not load profile", e);
        cached = undefined;
        return { username: ANONYMOUS_USERNAME };
      },
    );
  }
  return cached;
}

async function fetchProfile(client: Client): Promise<ClientProfile> {
  const base = client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length);
  const resp = await client.httpSpacePrimitives.authenticatedFetch(
    `${base}/.profile`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  if (!resp.ok) {
    throw new Error(`Profile request failed: ${resp.status}`);
  }
  return profileFrom(await resp.json());
}
