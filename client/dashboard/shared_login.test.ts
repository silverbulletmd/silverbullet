import { expect, test, vi } from "vitest";
import { forgetServiceWorker } from "./shared_login.ts";

function registration(scope: string) {
  return { scope, unregister: vi.fn(async () => true) };
}

test("drops only the worker registered for this space", async () => {
  const mine = registration("https://notes.test/work/");
  const other = registration("https://notes.test/");
  await forgetServiceWorker("https://notes.test/work/", {
    getRegistrations: async () => [mine, other],
  } as any);
  expect(mine.unregister).toHaveBeenCalled();
  expect(other.unregister).not.toHaveBeenCalled();
});

test("does nothing without service worker support", async () => {
  await expect(
    forgetServiceWorker("https://notes.test/", undefined),
  ).resolves.toBeUndefined();
});

test("gives up on a worker that never answers, so login still redirects", async () => {
  const hanging = {
    getRegistrations: () => new Promise<never>(() => {}),
  } as any;
  const started = Date.now();
  await forgetServiceWorker("https://notes.test/", hanging, 20);
  expect(Date.now() - started).toBeLessThan(1000);
});

test("a failing unregister does not reject", async () => {
  const broken = {
    getRegistrations: async () => {
      throw new Error("denied");
    },
  } as any;
  await expect(
    forgetServiceWorker("https://notes.test/", broken, 20),
  ).resolves.toBeUndefined();
});
