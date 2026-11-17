import { afterEach, expect, test, vi } from "vitest";
import { flushCachesAndUnregisterServiceWorker } from "./util.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeContainer(ready: Promise<unknown>) {
  const registration = { unregister: vi.fn(async () => true) };
  return {
    registration,
    container: {
      controller: {},
      addEventListener: vi.fn(),
      ready,
      getRegistrations: async () => [registration],
    },
  };
}

// A "Shared computer" boot waits on this before starting the editor: a
// worker that never confirms the flush must not hang boot.
test("a worker that never confirms the flush still gets unregistered", async () => {
  const { container, registration } = fakeContainer(new Promise(() => {}));
  vi.stubGlobal("navigator", { serviceWorker: container });
  const started = Date.now();
  await flushCachesAndUnregisterServiceWorker(20);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(registration.unregister).toHaveBeenCalled();
});

test("without a controlling worker it resolves at once", async () => {
  vi.stubGlobal("navigator", {
    serviceWorker: { controller: null },
  });
  await expect(flushCachesAndUnregisterServiceWorker(20)).resolves.toBe(
    undefined,
  );
});
