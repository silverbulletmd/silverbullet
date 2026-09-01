import { expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import { syncSyscalls } from "./sync.ts";

function readiness(client: Partial<Client>, paths: string[]): boolean[] {
  const syscall = syncSyscalls(client as Client)[
    "sync.areFilesReadyToIndex"
  ] as any;
  return syscall.callback({}, paths);
}

function client(overrides: Partial<Client> = {}): Partial<Client> {
  return {
    bootConfig: { disableServiceWorker: false } as any,
    fullSyncCompleted: false,
    fullIndexCompleted: false,
    serverPingMs: 100,
    syncedPaths: new Set<string>(),
    lastSyncProgressAt: Date.now(),
    ...overrides,
  };
}

test("a fast server makes every file ready", () => {
  expect(readiness(client({ serverPingMs: 5 }), ["a.md", "b.md"])).toEqual([
    true,
    true,
  ]);
});

test("a slow server defers files sync has not delivered yet", () => {
  const c = client({ syncedPaths: new Set(["a.md"]) });

  expect(readiness(c, ["a.md", "b.md"])).toEqual([true, false]);
});

test("deferral gives up once sync has stopped making progress", () => {
  vi.useFakeTimers();
  try {
    const c = client();

    expect(readiness(c, ["b.md"])).toEqual([false]);

    vi.advanceTimersByTime(60_000);

    expect(readiness(c, ["b.md"])).toEqual([true]);
  } finally {
    vi.useRealTimers();
  }
});

test("deferral holds as long as sync keeps reporting progress", () => {
  vi.useFakeTimers();
  try {
    const c = client();

    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(2_000);
      c.lastSyncProgressAt = Date.now();
      expect(readiness(c, ["b.md"])).toEqual([false]);
    }
  } finally {
    vi.useRealTimers();
  }
});
