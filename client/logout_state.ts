export const logoutStateKey = "sb-logout-state";

type LogoutState = {
  id: string;
  expires: number;
  revoked: boolean;
  destination?: string;
};

export function readLogoutState(): LogoutState | undefined {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(logoutStateKey);
  if (!raw) return;
  try {
    const state = JSON.parse(raw) as LogoutState;
    if (state.revoked || state.expires > Date.now()) return state;
  } catch {}
}

export function setLogoutState(
  id: string,
  revoked: boolean,
  destination?: string,
): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    logoutStateKey,
    JSON.stringify({ id, revoked, destination, expires: Date.now() + 30_000 }),
  );
}

export function clearLogoutState(id?: string): void {
  if (typeof localStorage === "undefined") return;
  if (!id || readLogoutState()?.id === id)
    localStorage.removeItem(logoutStateKey);
}

export function rememberLogoutForTab(): void {
  if (readLogoutState()?.revoked && typeof sessionStorage !== "undefined")
    sessionStorage.setItem(logoutStateKey, "revoked");
}

export function canCleanUpLogout(): boolean {
  return (
    !!readLogoutState()?.revoked ||
    (typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(logoutStateKey) === "revoked")
  );
}

export async function waitForLogout(): Promise<boolean> {
  let waited = false;
  while (true) {
    const state = readLogoutState();
    if (!state) {
      if (waited) location.reload();
      return !waited;
    }
    waited = true;
    if (state.revoked) {
      rememberLogoutForTab();
      location.replace(
        state.destination === "/.auth/central/signed-out"
          ? state.destination
          : "/.dashboard/login?signedOut=true",
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
