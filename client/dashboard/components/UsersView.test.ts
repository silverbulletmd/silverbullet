import { afterEach, expect, test, vi } from "vitest";

async function load() {
  (globalThis as any).document = {
    baseURI: "http://localhost:3000/.dashboard/",
  };
  (globalThis as any).location = { origin: "http://localhost:3000" };
  vi.resetModules();
  return await import("./UsersView.tsx");
}

afterEach(() => {
  delete (globalThis as any).document;
  delete (globalThis as any).location;
});

test("SSO username suggestion preserves the email local part", async () => {
  const { suggestUsernameFromEmail } = await load();
  expect(suggestUsernameFromEmail(" Morgan.Notes@Example.TEST ")).toBe(
    "Morgan.Notes",
  );
  expect(suggestUsernameFromEmail("morgan+notes@example.test")).toBe(
    "morgan+notes",
  );
});

test("SSO username suggestion rejects malformed email input", async () => {
  const { suggestUsernameFromEmail } = await load();
  expect(suggestUsernameFromEmail("morgan.example.test")).toBe("");
  expect(suggestUsernameFromEmail("@example.test")).toBe("");
  expect(suggestUsernameFromEmail("morgan@example@test")).toBe("");
});
