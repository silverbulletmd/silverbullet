import { expect, test } from "vitest";
import { changeMemberAccess } from "./runtime_permissions.ts";

test("writer opt-out survives role edits and unknown fields survive", () => {
  expect(
    changeMemberAccess(
      { role: "write", runtimeApi: false, future: 1 },
      "write",
    ),
  ).toEqual({ role: "write", runtimeApi: false, future: 1 });
});
test("removing write revokes runtime and restoring write does not restore it", () => {
  const reader = changeMemberAccess(
    { role: "write", runtimeApi: true },
    "read",
  );
  expect(reader).toEqual({ role: "read", runtimeApi: false });
  expect(changeMemberAccess(reader, "write")?.runtimeApi).toBe(false);
});
test("new writers default on and readers default off", () => {
  expect(changeMemberAccess(undefined, "write")).toEqual({
    role: "write",
    runtimeApi: true,
  });
  expect(changeMemberAccess(undefined, "read")).toEqual({
    role: "read",
    runtimeApi: false,
  });
  expect(changeMemberAccess({ role: "write" }, "none")).toBeUndefined();
});
