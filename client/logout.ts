import { randomUUID } from "../plug-api/lib/crypto.ts";
import { registerLogoutPresence } from "./logout_presence.ts";
import type { LogoutRoute } from "./dashboard_navigation.ts";
import {
  setLogoutState,
  rememberLogoutForTab,
  clearLogoutState,
  readLogoutState,
} from "./logout_state.ts";
import type { Client } from "./client.ts";

export const signedOutUrl = "/.dashboard/login?signedOut=true";

export type LogoutMessage = {
  type:
    | "logout-save"
    | "logout-cancel"
    | "logout-complete"
    | "logout-revoked"
    | "logout-preserve"
    | "logout-force";
  id: string;
  localLockIncomplete?: boolean;
};

type MessageTarget = {
  scriptURL?: string;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

export function requestLogoutMessage(
  target: MessageTarget,
  message: { type: string; id: string },
  timeout = message.type === "logout-sync" ? 10_000 : 5000,
): Promise<{ databases?: string[] }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error?: string, databases?: string[]) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(new Error(error));
      else resolve({ databases });
    };
    const timer = setTimeout(
      () =>
        finish(
          target.scriptURL
            ? `The SilverBullet background worker for ${new URL(".", target.scriptURL).pathname} did not respond. Open that space, reload it, then retry logout.`
            : "Close other SilverBullet tabs and try logging out again. A tab did not confirm its edits were saved.",
        ),
      timeout,
    );
    channel.port1.onmessage = (event) =>
      finish(
        event.data?.ok === true
          ? undefined
          : event.data?.error || "Could not prepare another tab for logout.",
        event.data?.databases,
      );
    try {
      target.postMessage(message, [channel.port2]);
    } catch {
      finish(
        "Could not contact another SilverBullet tab. Close it and try again.",
      );
    }
  });
}

export class LogoutParticipant {
  private attempt?: { id: string; saved: Promise<void> };
  private revoked = false;
  private preserved = false;

  constructor(
    private save: () => Promise<void>,
    private freeze: (value: boolean) => void,
    private leave: (localLockIncomplete?: boolean) => void,
  ) {}

  get active() {
    return this.revoked || this.attempt !== undefined;
  }

  async handle(message: LogoutMessage, port?: MessagePort): Promise<void> {
    if (message.type === "logout-force") {
      this.revoked = true;
      this.freeze(true);
      this.leave(message.localLockIncomplete);
      port?.postMessage({ ok: true });
    } else if (
      message.type === "logout-revoked" ||
      message.type === "logout-preserve"
    ) {
      this.revoked = true;
      if (message.type === "logout-preserve") {
        this.preserved = true;
        this.freeze(false);
      }
    } else if (message.type === "logout-save") {
      if (this.preserved) {
        port?.postMessage({
          ok: false,
          error: "This editor is open for recovery after sign-out.",
        });
        return;
      }
      if (this.attempt && this.attempt.id !== message.id) {
        port?.postMessage({
          ok: false,
          error: "Another logout is already in progress.",
        });
        return;
      }
      if (!this.attempt) {
        this.freeze(true);
        this.attempt = {
          id: message.id,
          saved: Promise.resolve().then(() => this.save()),
        };
      }
      try {
        await this.attempt.saved;
        if (this.attempt?.id !== message.id)
          throw new Error("Logout was cancelled.");
        port?.postMessage({ ok: true });
      } catch (error) {
        port?.postMessage({
          ok: false,
          error:
            error instanceof Error ? error.message : "Could not save this tab.",
        });
        if (this.revoked) this.freeze(false);
        if (!port) throw error;
      }
    } else if (this.attempt?.id === message.id) {
      if (message.type === "logout-complete") {
        this.revoked = true;
        const attempt = this.attempt;
        try {
          await attempt.saved;
          if (this.attempt === attempt && !this.preserved)
            this.leave(message.localLockIncomplete);
        } catch {
          this.freeze(false);
        }
      } else {
        if (!this.revoked) this.attempt = undefined;
        else this.preserved = true;
        this.freeze(false);
      }
    }
  }
}

let participant: LogoutParticipant | undefined;
let httpPresence: ReturnType<typeof registerLogoutPresence> | undefined;
let initiatingLogout = false;

function logoutDestination(localLockIncomplete = false): string {
  rememberLogoutForTab();
  const target =
    readLogoutState()?.destination === "/.auth/central/signed-out"
      ? "/.auth/central/signed-out"
      : signedOutUrl;
  return (
    target +
    (localLockIncomplete
      ? `${target.includes("?") ? "&" : "?"}localLockIncomplete=true`
      : "")
  );
}

export function logoutInProgress(): boolean {
  return participant?.active ?? false;
}

export function registerLogoutParticipant(
  saveCurrent: () => Promise<void>,
): () => void {
  if (participant) return () => {};
  const previousInert = document.documentElement.inert;
  let releaseLock: (() => void) | undefined;
  const lockAbort = new AbortController();
  const held = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  void navigator.locks
    ?.request(
      "silverbullet-logout-participant",
      { mode: "shared", signal: lockAbort.signal },
      () => held,
    )
    .catch(() => {});
  const registered = new LogoutParticipant(
    saveCurrent,
    (value) => {
      document.documentElement.inert = value || previousInert;
    },
    (localLockIncomplete) => {
      if (!initiatingLogout)
        location.href = logoutDestination(localLockIncomplete);
    },
  );
  participant = registered;
  if (globalThis.isSecureContext === false) {
    httpPresence = registerLogoutPresence(localStorage);
  }
  const closePresence = () => httpPresence?.close();
  const restorePresence = (event: PageTransitionEvent) => {
    if (event.persisted) location.reload();
  };
  if (httpPresence) {
    globalThis.addEventListener?.("pagehide", closePresence);
    globalThis.addEventListener?.("pageshow", restorePresence);
  }
  const listener = (event: MessageEvent) => {
    if (
      [
        "logout-save",
        "logout-cancel",
        "logout-complete",
        "logout-revoked",
        "logout-preserve",
        "logout-force",
      ].includes(event.data?.type)
    ) {
      void registered.handle(event.data, event.ports[0]);
    }
  };
  navigator.serviceWorker?.addEventListener("message", listener);
  const channel =
    typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel("silverbullet-logout");
  if (channel)
    channel.onmessage = (event) => {
      if (
        ["logout-force", "logout-complete", "logout-cancel"].includes(
          event.data?.type,
        )
      )
        void registered.handle(event.data);
    };
  return () => {
    navigator.serviceWorker?.removeEventListener("message", listener);
    channel?.close();
    closePresence();
    httpPresence = undefined;
    globalThis.removeEventListener?.("pagehide", closePresence);
    globalThis.removeEventListener?.("pageshow", restorePresence);
    if (participant === registered) participant = undefined;
    releaseLock?.();
    lockAbort.abort();
  };
}

export class LogoutSyncError extends Error {}

export const forceLogoutWarning =
  "Force logout? Unsynchronized edits will be permanently deleted from this device.";

export async function logoutBrowserSession(
  saveCurrent: () => Promise<void>,
  force = false,
  route?: LogoutRoute,
): Promise<void> {
  const unregister = participant
    ? () => {}
    : registerLogoutParticipant(saveCurrent);
  const current = participant!;
  if (current.active) throw new Error("Logout is already in progress.");
  const id = randomUUID();
  let workers: ServiceWorker[] = [];
  let revoked = false;
  let localLockIncomplete = false;
  let preparationFailure = "";
  initiatingLogout = true;
  const cancel = (worker: ServiceWorker) => {
    try {
      worker.postMessage({
        type: revoked ? "logout-preserve" : "logout-cancel",
        id,
      });
    } catch {}
  };
  try {
    setLogoutState(id, false, route?.destination);
    if (!force) {
      try {
        await requestLogoutMessage(
          {
            postMessage(message, ports) {
              void current.handle(
                message as LogoutMessage,
                ports[0] as MessagePort,
              );
            },
          },
          { type: "logout-save", id },
          10_000,
        );
      } catch (error) {
        throw new LogoutSyncError(
          error instanceof Error ? error.message : "Could not save edits.",
        );
      }
    }
    try {
      const registrations =
        (await navigator.serviceWorker?.getRegistrations()) ?? [];
      workers = registrations.flatMap((registration) =>
        registration.active &&
        new URL(registration.active.scriptURL).pathname.endsWith(
          "/service_worker.js",
        )
          ? [registration.active]
          : [],
      );
      if (workers.length === 0 && navigator.locks) {
        const locks = await navigator.locks.query();
        const clients = new Set(
          [...(locks.held ?? []), ...(locks.pending ?? [])]
            .filter((lock) => lock.name === "silverbullet-logout-participant")
            .map((lock, index) => lock.clientId ?? `unknown-${index}`),
        );
        if (clients.size > 1) {
          preparationFailure =
            "Other SilverBullet windows have not confirmed their edits are saved. Close them and retry, or choose Force logout.";
        }
      }
      if (httpPresence && !httpPresence.isAlone()) {
        preparationFailure =
          "Close other SilverBullet tabs and windows before logging out over HTTP. If a tab crashed, save all open editors before choosing Force logout.";
      }
    } catch (error) {
      preparationFailure = `Could not check open SilverBullet windows: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (!force) {
      const preparation = await Promise.allSettled(
        workers.map((worker) =>
          requestLogoutMessage(worker, { type: "logout-sync", id }),
        ),
      );
      const covered = new Set(
        preparation.flatMap((result) =>
          result.status === "fulfilled" ? (result.value.databases ?? []) : [],
        ),
      );
      const databases =
        typeof indexedDB === "undefined" ? [] : await indexedDB.databases();
      if (
        databases.some(
          (db) => db.name?.startsWith("sb_files_") && !covered.has(db.name),
        )
      ) {
        throw new LogoutSyncError(
          "Some local spaces could not be synchronized. Open and unlock those spaces, or force logout to discard their local data.",
        );
      }
      const failed = preparation.find((result) => result.status === "rejected");
      if (failed?.status === "rejected" || preparationFailure) {
        throw new LogoutSyncError(
          failed?.status === "rejected"
            ? failed.reason.message
            : preparationFailure,
        );
      }
    }
    const response = await fetch(route?.endpoint ?? "/.dashboard/api/logout", {
      ...(route ? { method: route.method } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error(
        "Could not log out. Your edits remain saved on this device.",
      );
    revoked = true;
    setLogoutState(id, true, route?.destination);
    await current.handle({ type: "logout-revoked", id });
    for (const worker of workers) {
      try {
        worker.postMessage({ type: "logout-revoked", id });
      } catch {
        localLockIncomplete = true;
      }
    }
    const cleared = await Promise.allSettled(
      workers.map((worker) =>
        requestLogoutMessage(worker, {
          type: force ? "logout-force" : "logout-clear",
          id,
        }),
      ),
    );
    localLockIncomplete ||= cleared.some(
      (result) => result.status === "rejected",
    );
    for (const worker of workers) {
      try {
        worker.postMessage({
          type: "logout-complete",
          id,
          localLockIncomplete,
        });
      } catch {
        localLockIncomplete = true;
      }
    }
    const channel =
      typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel("silverbullet-logout");
    channel?.postMessage({
      type: force ? "logout-force" : "logout-complete",
      id,
      localLockIncomplete,
    });
    channel?.close();
    location.href = logoutDestination(localLockIncomplete);
  } catch (error) {
    for (const worker of workers) cancel(worker);
    if (revoked) {
      location.href = logoutDestination(true);
      return;
    }
    clearLogoutState(id);
    await current.handle({ type: "logout-cancel", id });
    throw error;
  } finally {
    initiatingLogout = false;
    unregister();
  }
}

export async function saveCurrentEditor(client: Client): Promise<void> {
  await client.contentManager.save(true);
  if (client.ui.viewState.unsavedChanges) {
    throw new Error(
      "Finish saving this editor before leaving, then try again.",
    );
  }
}
