import { expect, test } from "vitest";
import {
  mcpUnavailableReason,
  runtimeApiUnavailableReason,
} from "./runtime_availability.ts";

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

test("MCP has nothing to explain unless the env disabled it", () => {
  expect(mcpUnavailableReason({ status: "available" })).toBeNull();
  expect(mcpUnavailableReason(null)).toBeNull();
  expect(mcpUnavailableReason({ status: "disabled_by_env" })).toBe(
    "Disabled server-wide by SB_MCP=0.",
  );
  expect(mcpUnavailableReason({ status: "failed", message: "bad file" })).toBe(
    "Unavailable: bad file",
  );
});
