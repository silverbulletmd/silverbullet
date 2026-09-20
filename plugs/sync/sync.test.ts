import { afterEach, expect, test } from "vitest";
import { syncFileCommand, syncSpaceCommand } from "./sync.ts";

const originalSyscall = globalThis.syscall;
const calls: string[] = [];

afterEach(() => {
  globalThis.syscall = originalSyscall;
  calls.length = 0;
});

function mockSyscalls(handlers: Record<string, (...args: any[]) => any>) {
  globalThis.syscall = async (name: string, ...args: any[]) => {
    calls.push(name);
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`Unexpected syscall: ${name}`);
    }
    return handler(...args);
  };
}

test("Sync: Space refuses without claiming Done when the service worker is off", async () => {
  const flashes: Array<[string, string?]> = [];
  mockSyscalls({
    "sync.isEnabled": () => false,
    "editor.flashNotification": (message: string, type?: string) => {
      flashes.push([message, type]);
    },
  });

  await syncSpaceCommand();

  expect(flashes).toEqual([
    ["Sync is disabled because the service worker is off", "error"],
  ]);
  expect(calls).not.toContain("sync.performSpaceSync");
});

test("Sync: File refuses without claiming Done when the service worker is off", async () => {
  const flashes: Array<[string, string?]> = [];
  mockSyscalls({
    "sync.isEnabled": () => false,
    "editor.flashNotification": (message: string, type?: string) => {
      flashes.push([message, type]);
    },
  });

  await syncFileCommand();

  expect(flashes).toEqual([
    ["Sync is disabled because the service worker is off", "error"],
  ]);
  expect(calls).not.toContain("sync.performFileSync");
  expect(calls).not.toContain("editor.getCurrentPath");
});

test("Sync: Space still syncs and reports Done when the service worker is on", async () => {
  const flashes: string[] = [];
  mockSyscalls({
    "sync.isEnabled": () => true,
    "editor.flashNotification": (message: string) => {
      flashes.push(message);
    },
    "sync.performSpaceSync": () => 1,
  });

  await syncSpaceCommand();

  expect(flashes).toEqual(["Syncing space...", "Done."]);
  expect(calls).toContain("sync.performSpaceSync");
});

test("Sync: File still syncs and reports Done when the service worker is on", async () => {
  const flashes: string[] = [];
  mockSyscalls({
    "sync.isEnabled": () => true,
    "editor.flashNotification": (message: string) => {
      flashes.push(message);
    },
    "editor.getCurrentPath": () => "index.md",
    "sync.performFileSync": () => {},
  });

  await syncFileCommand();

  expect(flashes).toEqual(["Syncing file...", "Done."]);
  expect(calls).toContain("sync.performFileSync");
});
