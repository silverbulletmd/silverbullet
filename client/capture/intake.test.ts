import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import {
  handleShareTarget,
  isShareTarget,
  refreshShareEligibility,
} from "./intake.ts";
import { openCaptureStore } from "./store.ts";

const origin = "https://example.test";

test("a multipart share stages fields and files then redirects with only its id", async () => {
  const store = await openCaptureStore(
    `${origin}/work/${crypto.randomUUID()}/service_worker.js`,
  );
  await store.configure("owner-a", true);
  const form = new FormData();
  form.set("title", "Shared title");
  form.set("text", "https://source.test/story");
  form.set("url", "");
  form.append(
    "files",
    new File([Uint8Array.from([7, 0, 255])], "image.png", {
      type: "image/png",
    }),
  );
  const request = new Request(`${origin}/work/.client/share-target`, {
    method: "POST",
    body: form,
  });
  const response = await handleShareTarget(request, "/work", store);
  expect(response.status).toBe(303);
  const location = response.headers.get("Location")!;
  expect(location).toMatch(/^\/work\/\?capture=[a-f0-9-]+$/);
  expect(location).not.toContain("source.test");
  const id = new URL(location, origin).searchParams.get("capture")!;
  const capture = await store.get(id, "owner-a");
  expect(capture?.title).toBe("Shared title");
  expect(capture?.text).toBe("https://source.test/story");
  expect(capture?.url).toBe("");
  const blob = await store.readFile(id, capture!.files[0].handle, "owner-a");
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([7, 0, 255]);
});

test("only the exact same-origin POST route is intercepted", () => {
  const target = `${origin}/work/.client/share-target`;
  expect(
    isShareTarget(new Request(target, { method: "POST" }), "/work", origin),
  ).toBe(true);
  expect(isShareTarget(new Request(target), "/work", origin)).toBe(false);
  expect(
    isShareTarget(
      new Request(`${target}/other`, { method: "POST" }),
      "/work",
      origin,
    ),
  ).toBe(false);
  expect(
    isShareTarget(
      new Request("https://other.test/work/.client/share-target", {
        method: "POST",
      }),
      "/work",
      origin,
    ),
  ).toBe(false);
});

test("an ineligible or oversized share leaves no pending capture", async () => {
  const store = await openCaptureStore(
    `${origin}/${crypto.randomUUID()}/service_worker.js`,
  );
  await store.configure("owner-a", false);
  const form = new FormData();
  form.set("text", "example");
  const target = `${origin}/.client/share-target`;
  const forbidden = await handleShareTarget(
    new Request(target, { method: "POST", body: form }),
    "",
    store,
  );
  expect(forbidden.status).toBe(403);
  await store.configure("owner-a", true);
  const tooLarge = await handleShareTarget(
    new Request(target, {
      method: "POST",
      body: form,
      headers: { "content-length": String(101 * 1024 * 1024) },
    }),
    "",
    store,
  );
  expect(tooLarge.status).toBe(413);
  expect(await store.list("owner-a")).toEqual([]);
});

test("a newly read-only server disables a stale installed share target", async () => {
  const store = await openCaptureStore(
    `${origin}/${crypto.randomUUID()}/service_worker.js`,
  );
  await store.configure("owner-a", true);
  await refreshShareEligibility(
    store,
    `${origin}/.config`,
    async () =>
      new Response(
        JSON.stringify({
          shareOwnerId: "owner-a",
          readOnly: true,
          enableClientEncryption: false,
          disableServiceWorker: false,
        }),
        { status: 200 },
      ),
  );
  expect(await store.getConfiguration()).toEqual({
    ownerId: "owner-a",
    eligible: false,
  });
});

test("offline eligibility refresh keeps the last known eligible state", async () => {
  const store = await openCaptureStore(
    `${origin}/${crypto.randomUUID()}/service_worker.js`,
  );
  await store.configure("owner-a", true);
  await refreshShareEligibility(store, `${origin}/.config`, async () => {
    throw new Error("offline");
  });
  expect(await store.getConfiguration()).toEqual({
    ownerId: "owner-a",
    eligible: true,
  });
});
