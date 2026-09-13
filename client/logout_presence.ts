import { randomUUID } from "../plug-api/lib/crypto.ts";

const prefix = "silverbullet.logout-participant.";

export function registerLogoutPresence(
  storage: Pick<Storage, "length" | "key" | "setItem" | "removeItem">,
) {
  const key = prefix + randomUUID();
  let registered = false;
  try {
    storage.setItem(key, "open");
    registered = true;
  } catch {}
  return {
    isAlone(): boolean {
      if (!registered) return false;
      try {
        for (let i = 0; i < storage.length; i++) {
          const other = storage.key(i);
          if (other?.startsWith(prefix) && other !== key) return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    close(): void {
      try {
        storage.removeItem(key);
      } catch {}
      registered = false;
    },
  };
}
