// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import type { MemberEntry } from "../types.ts";
import { AccessGrid } from "./AccessGrid.tsx";

const root = document.createElement("div");
document.body.append(root);
afterEach(() => render(null, root));

function grid(member: MemberEntry, frozen = false) {
  const onChange = vi.fn();
  act(() =>
    render(
      h(AccessGrid, {
        users: {
          robin: {
            admin: false,
            disabled: false,
            loginMethod: "local",
            fullName: null,
            email: null,
            sso: null,
            tokens: {},
          },
        },
        members: { robin: member },
        frozen,
        runtimeAvailable: true,
        onRuntimeChange: vi.fn(),
        onChange,
      }),
      root,
    ),
  );
  return onChange;
}
function checkbox(label: string) {
  return root.querySelector<HTMLInputElement>(
    `input[aria-label="robin: ${label}"]`,
  )!;
}

test("Editor is selectable between Reader and Builder with distinct wire roles", () => {
  const onChange = grid({ role: "read" });
  act(() => checkbox("Editor").click());
  expect(onChange).toHaveBeenLastCalledWith("robin", "edit");
  act(() => checkbox("Builder").click());
  expect(onChange).toHaveBeenLastCalledWith("robin", "write");
});

test("Editor cannot enable Runtime API even when a stale grant is present", () => {
  grid({ role: "edit", runtimeApi: true });
  expect(checkbox("Editor").checked).toBe(true);
  expect(checkbox("Builder").checked).toBe(false);
  expect(checkbox("Runtime API").checked).toBe(false);
  expect(checkbox("Runtime API").disabled).toBe(true);
});

test("existing write grants remain Builder and lowering them selects Editor", () => {
  const onChange = grid({ role: "write" });
  expect(checkbox("Builder").checked).toBe(true);
  expect(checkbox("Runtime API").checked).toBe(true);
  expect(checkbox("Runtime API").disabled).toBe(false);
  act(() => checkbox("Builder").click());
  expect(onChange).toHaveBeenLastCalledWith("robin", "edit");
});

test("frozen spaces suspend both editing roles", () => {
  grid({ role: "write" }, true);
  expect(checkbox("Reader").disabled).toBe(false);
  expect(checkbox("Editor").disabled).toBe(true);
  expect(checkbox("Builder").disabled).toBe(true);
  expect(checkbox("Runtime API").disabled).toBe(true);
});
