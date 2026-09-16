import { afterEach, expect, test, vi } from "vitest";
import { MemoryKvPrimitives } from "./data/memory_kv_primitives.ts";
import {
  LogoutParticipant,
  requestLogoutMessage,
  logoutBrowserSession,
} from "./logout.ts";

afterEach(() => vi.unstubAllGlobals());

test("another tab saves its unsaved buffer before logout can revoke", async () => {
  const queued = new MemoryKvPrimitives();
  let buffer = "Unsynced field notes";
  let frozen = false;
  let navigated = false;
  const participant = new LogoutParticipant(
    async () => {
      expect(frozen).toBe(true);
      await queued.batchSet([{ key: ["pending", "Notes"], value: buffer }]);
      buffer = "";
    },
    (value) => {
      frozen = value;
    },
    () => {
      navigated = true;
    },
  );
  const target = {
    postMessage(data: any, ports: Transferable[]) {
      void participant.handle(data, ports[0] as MessagePort);
    },
  };
  await requestLogoutMessage(target, { type: "logout-save", id: "one" });
  expect(await queued.batchGet([["pending", "Notes"]])).toEqual([
    "Unsynced field notes",
  ]);
  expect(buffer).toBe("");
  expect(navigated).toBe(false);
  await participant.handle({ type: "logout-complete", id: "one" });
  expect(navigated).toBe(true);
  expect(await queued.batchGet([["pending", "Notes"]])).toEqual([
    "Unsynced field notes",
  ]);
});

test("failed save preserves the other tab buffer and cancellation unlocks it", async () => {
  const buffer = "Only in this editor";
  let frozen = false;
  const participant = new LogoutParticipant(
    async () => {
      throw new Error("disk full");
    },
    (value) => {
      frozen = value;
    },
    () => {
      throw new Error("must not leave");
    },
  );
  const target = {
    postMessage(data: any, ports: Transferable[]) {
      void participant.handle(data, ports[0] as MessagePort);
    },
  };
  await expect(
    requestLogoutMessage(target, { type: "logout-save", id: "one" }),
  ).rejects.toThrow("disk full");
  await participant.handle({ type: "logout-cancel", id: "one" });
  expect(frozen).toBe(false);
  expect(buffer).toBe("Only in this editor");
});

test("failed synchronization keeps the session and offers force logout", async () => {
  const fetcher = logoutEnvironment({
    scriptURL: "https://notes.example/service_worker.js",
    postMessage(message, ports) {
      ports?.[0]?.postMessage({ ok: false, error: "Offline" });
    },
  });
  await expect(logoutBrowserSession(async () => {})).rejects.toThrow("Offline");
  expect(fetcher).not.toHaveBeenCalled();
  expect(location.href).toBe("https://notes.example/.dashboard/");
});

test("an unresponsive worker is identified instead of blaming another tab", async () => {
  await expect(
    requestLogoutMessage(
      {
        scriptURL: "http://localhost:3000/public/service_worker.js",
        postMessage() {},
      },
      { type: "logout-sync", id: "silent-worker" },
      10,
    ),
  ).rejects.toThrow(
    "The SilverBullet background worker for /public/ did not respond",
  );
});

test("a completion message never navigates an editor whose save failed", async () => {
  const leave = vi.fn();
  const tab = new LogoutParticipant(
    async () => {
      throw new Error("disk full");
    },
    () => {},
    leave,
  );
  await expect(
    tab.handle({ type: "logout-save", id: "failed" }),
  ).rejects.toThrow("disk full");
  await tab.handle({
    type: "logout-complete",
    id: "failed",
    localLockIncomplete: true,
  });
  expect(leave).not.toHaveBeenCalled();
});

function logoutEnvironment(worker?: {
  scriptURL: string;
  postMessage: (...args: any[]) => void;
}) {
  const fetcher = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("document", { documentElement: { inert: false } });
  vi.stubGlobal("location", { href: "https://notes.example/.dashboard/" });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistrations: async () => (worker ? [{ active: worker }] : []),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  return fetcher;
}

test("force logout skips a failed save and does not wait for synchronization", async () => {
  const fetcher = logoutEnvironment();
  await logoutBrowserSession(async () => {
    throw new Error("Offline");
  }, true);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(location.href).toContain("signedOut=true");
});

test("a failed initiating editor save still prevents logout", async () => {
  const fetcher = logoutEnvironment();
  await expect(
    logoutBrowserSession(async () => {
      throw new Error("Storage full");
    }),
  ).rejects.toThrow("Storage full");
  expect(fetcher).not.toHaveBeenCalled();
  expect(document.documentElement.inert).toBe(false);
});

test("a failed server revocation restores the current tab", async () => {
  logoutEnvironment();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  await expect(logoutBrowserSession(async () => {})).rejects.toThrow(
    "Could not log out",
  );
  expect(location.href).toBe("https://notes.example/.dashboard/");
  expect(document.documentElement.inert).toBe(false);
});

test("failed key clearing shows a warning after server revocation", async () => {
  const messages: any[] = [];
  const fetcher = logoutEnvironment({
    scriptURL: "https://notes.example/notes/service_worker.js",
    postMessage(message, ports) {
      messages.push(message);
      ports?.[0]?.postMessage({
        ok: message.type !== "logout-clear",
        error: "Key cleanup failed",
      });
    },
  });
  await logoutBrowserSession(async () => {});
  expect(fetcher).toHaveBeenCalledOnce();
  expect(messages.at(-1)).toMatchObject({
    type: "logout-complete",
    localLockIncomplete: true,
  });
  expect(location.href).toContain("localLockIncomplete=true");
});

test("successful logout finishes local cleanup before navigating", async () => {
  const messages: string[] = [];
  logoutEnvironment({
    scriptURL: "https://notes.example/notes/service_worker.js",
    postMessage(message, ports) {
      messages.push(message.type);
      expect(location.href).toBe("https://notes.example/.dashboard/");
      ports?.[0]?.postMessage({ ok: true });
    },
  });
  await logoutBrowserSession(async () => {});
  expect(messages).toEqual([
    "logout-sync",
    "logout-revoked",
    "logout-clear",
    "logout-complete",
  ]);
  expect(location.href).toBe("/.dashboard/login?signedOut=true");
});

test("revoked unsaved editors stay editable without allowing automatic auth redirects", async () => {
  let frozen = false;
  const leave = vi.fn();
  const tab = new LogoutParticipant(
    async () => {
      throw new Error("disk full");
    },
    (value) => {
      frozen = value;
    },
    leave,
  );
  await expect(
    tab.handle({ type: "logout-save", id: "draft" }),
  ).rejects.toThrow("disk full");
  await tab.handle({ type: "logout-revoked", id: "draft" });
  await tab.handle({ type: "logout-preserve", id: "draft" });
  await tab.handle({ type: "logout-cancel", id: "draft" });
  expect(frozen).toBe(false);
  expect(tab.active).toBe(true);
  expect(leave).not.toHaveBeenCalled();
});

test("preserving a saved editor invalidates delayed completion", async () => {
  const leave = vi.fn();
  let draft = "Saved version";
  const tab = new LogoutParticipant(
    async () => {},
    () => {},
    leave,
  );
  await tab.handle({ type: "logout-save", id: "saved" });
  await tab.handle({ type: "logout-preserve", id: "saved" });
  draft = "New edits after recovery became available";
  await tab.handle({ type: "logout-complete", id: "saved" });
  expect(leave).not.toHaveBeenCalled();
  expect(draft).toBe("New edits after recovery became available");
});

test("normal logout refuses to delete an orphaned offline database", async () => {
  const fetcher = logoutEnvironment();
  vi.stubGlobal("indexedDB", {
    databases: async () => [{ name: `sb_files_${"b".repeat(64)}` }],
  });
  await expect(logoutBrowserSession(async () => {})).rejects.toThrow(
    /synchroniz/i,
  );
  expect(fetcher).not.toHaveBeenCalled();
});

test("multiple logout locks belonging to the same browser tab do not block logout", async () => {
  const fetcher = logoutEnvironment();
  Object.assign(navigator, {
    locks: {
      request: async () => {},
      query: async () => ({
        held: [
          { name: "silverbullet-logout-participant", clientId: "current-tab" },
          { name: "silverbullet-logout-participant", clientId: "current-tab" },
        ],
        pending: [],
      }),
    },
  });
  await logoutBrowserSession(async () => {});
  expect(fetcher).toHaveBeenCalledOnce();
});

test("worker enumeration failure reports the cause instead of an ambiguous synchronization error", async () => {
  logoutEnvironment();
  navigator.serviceWorker.getRegistrations = async () => {
    throw new Error("Synthetic enumeration failure");
  };
  await expect(logoutBrowserSession(async () => {})).rejects.toThrow(
    "Synthetic enumeration failure",
  );
});
