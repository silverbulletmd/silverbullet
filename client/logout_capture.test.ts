import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { openCaptureStore } from "./capture/store.ts";
import { logoutBrowserSession } from "./logout.ts";

afterEach(() => vi.unstubAllGlobals());

test("sign-out warns about pending captures before revoking the session", async () => {
  const scriptURL = `https://notes.example/${crypto.randomUUID()}/service_worker.js`;
  const store = await openCaptureStore(scriptURL);
  await store.configure("owner-a", true);
  const id = await store.stage({ title: "Pending", text: "", url: "" }, []);
  await store.configure("owner-b", true);
  const fetcher = vi.fn(async () => ({ ok: true }));
  const confirm = vi.fn(() => false);
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("confirm", confirm);
  vi.stubGlobal("location", { href: "https://notes.example/.dashboard/" });
  vi.stubGlobal("document", { documentElement: { inert: false } });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistrations: async () => [
        {
          active: {
            scriptURL,
            postMessage(_message: unknown, ports?: MessagePort[]) {
              ports?.[0]?.postMessage({ ok: true });
            },
          },
        },
      ],
      addEventListener() {},
      removeEventListener() {},
    },
  });
  await logoutBrowserSession(async () => {});
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining("1 pending capture"),
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(await store.get(id, "owner-a")).toBeDefined();
});
