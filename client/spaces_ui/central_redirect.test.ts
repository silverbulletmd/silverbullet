import { afterEach, expect, test, vi } from "vitest";
import { redirectToCentral } from "./central_redirect.ts";

afterEach(() => vi.unstubAllGlobals());

test("insecure HTTP keeps password login local even when central login is configured", async () => {
  const replace = browser(true);
  vi.stubGlobal("isSecureContext", false);
  expect(await redirectToCentral("/")).toBe(false);
  expect(replace).not.toHaveBeenCalled();
});
function browser(configured: boolean) {
  const replace = vi.fn();
  vi.stubGlobal("location", { origin: "https://notes.test", replace });
  vi.stubGlobal("localStorage", { getItem: () => "true" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        configured: configured
          ? { centralOrigin: "https://login.sb.test" }
          : null,
      }),
    })),
  );
  return replace;
}

test("starts on the destination origin and preserves the requested page and encryption choice", async () => {
  const replace = browser(true);
  expect(await redirectToCentral("/Project?headless=1")).toBe(true);
  const target = new URL(replace.mock.calls[0][0]);
  expect(target.origin).toBe("https://notes.test");
  expect(target.pathname).toBe("/.auth/central/start");
  expect(target.searchParams.get("destination")).toBe(
    "https://notes.test/Project?headless=1",
  );
  expect(target.searchParams.get("encrypt")).toBe("true");
});
test("keeps existing local sign-in when central login is not configured", async () => {
  const replace = browser(false);
  expect(await redirectToCentral("/")).toBe(false);
  expect(replace).not.toHaveBeenCalled();
});
test("does not start a login for an externally supplied destination", async () => {
  const replace = browser(true);
  expect(await redirectToCentral("https://outside.test/")).toBe(false);
  expect(replace).not.toHaveBeenCalled();
});
