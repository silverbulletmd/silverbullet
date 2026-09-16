import { expect, test } from "vitest";
import { runtimeApiUnavailableReason } from "./runtime_availability.ts";

test("an available runtime has nothing to explain", () => {
  expect(runtimeApiUnavailableReason({ status: "available" })).toBeNull();
});

test("an unknown availability leaves the checkbox usable", () => {
  // `null` is what a failed fetch leaves behind. Locking the setting because
  // one request blipped would be worse than letting the admin try.
  expect(runtimeApiUnavailableReason(null)).toBeNull();
});

test("a missing browser is reported as such", () => {
  expect(runtimeApiUnavailableReason({ status: "no_chrome" })).toContain(
    "No Chrome or Chromium found",
  );
});

test("the env opt-out is reported as a deliberate choice", () => {
  expect(runtimeApiUnavailableReason({ status: "disabled_by_env" })).toContain(
    "SB_RUNTIME_API=0",
  );
});

test("a pool failure surfaces the server's own message", () => {
  expect(
    runtimeApiUnavailableReason({ status: "failed", message: "boom" }),
  ).toBe("Unavailable: boom");
});
