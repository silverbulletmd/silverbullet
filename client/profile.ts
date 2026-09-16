import { dashboardSessionRoutes } from "./dashboard_navigation.ts";
export type ProfileState =
  | {
      status: "signed-in";
      username: string;
      fullName: string | null;
      admin: boolean;
    }
  | { status: "signed-out" }
  | { status: "unavailable" };

export async function loadProfile(
  fetchFn: typeof fetch = fetch,
): Promise<ProfileState> {
  try {
    const { profile } = await dashboardSessionRoutes(fetchFn);
    const response = await fetchFn(profile);
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
