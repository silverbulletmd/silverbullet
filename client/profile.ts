export type ProfileState =
  | {
      status: "signed-in";
      username: string;
      fullName: string | null;
      admin: boolean;
    }
  | { status: "signed-out" }
  | { status: "unavailable" };

/**
 * Origin-absolute on purpose: a prefix-bound space's `document.baseURI` is
 * `/wiki/`, and a relative fetch would ask `/wiki/.spaces/...`, which does not
 * exist. `/.spaces` is mounted ahead of the space dispatcher on every host.
 */
const PROFILE_URL = "/.spaces/api/profile";

export async function loadProfile(
  fetchFn: typeof fetch = fetch,
): Promise<ProfileState> {
  try {
    const response = await fetchFn(PROFILE_URL);
    if (response.status === 401) {
      return { status: "signed-out" };
    }
    if (!response.ok) {
      return { status: "unavailable" };
    }
    const body = await response.json();
    return {
      status: "signed-in",
      username: body.username,
      fullName: body.fullName ?? null,
      admin: !!body.admin,
    };
  } catch {
    return { status: "unavailable" };
  }
}

export function initials(profile: {
  username: string;
  fullName?: string | null;
}): string {
  const source = profile.fullName?.trim() || profile.username;
  const parts = source.split(/\s+/).filter(Boolean);
  const chars =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? ""];
  return chars
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();
}
