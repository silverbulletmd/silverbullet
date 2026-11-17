// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import { LoginForm, type LoginValues } from "./LoginForm.tsx";

const SHARED_LABEL = "Shared computer (sign out when the browser closes)";

let root: HTMLElement;

function mount(props: Partial<Parameters<typeof LoginForm>[0]> = {}) {
  const onSubmit = vi.fn<(values: LoginValues) => void>();
  root = document.createElement("div");
  document.body.appendChild(root);
  void act(() => {
    render(
      h(LoginForm, {
        title: "My Space",
        showSharedComputer: true,
        onSubmit,
        ...props,
      }),
      root,
    );
  });
  return onSubmit;
}

function checkbox(label: string): HTMLInputElement | null {
  const found = [...root.querySelectorAll("label")].find((l) =>
    l.textContent?.includes(label),
  );
  if (!found) return null;
  return (found.querySelector("input") ??
    root.querySelector(`#${found.htmlFor}`)) as HTMLInputElement;
}

function type(id: string, value: string) {
  const input = root.querySelector(`#${id}`) as HTMLInputElement;
  void act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function tick(box: HTMLInputElement) {
  void act(() => {
    box.click();
  });
}

function submit() {
  void act(() => {
    (root.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

afterEach(() => {
  render(null, root);
  root.remove();
});

test("submits sharedComputer when the box is ticked", () => {
  const onSubmit = mount();
  type("username", "river");
  type("password", "secret");
  tick(checkbox(SHARED_LABEL)!);
  submit();
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      username: "river",
      password: "secret",
      sharedComputer: true,
    }),
  );
});

test("shared computer is off by default", () => {
  const onSubmit = mount();
  expect(checkbox(SHARED_LABEL)!.checked).toBe(false);
  submit();
  expect(onSubmit.mock.calls[0][0].sharedComputer).toBe(false);
});

test("has no remember-me checkbox", () => {
  mount();
  expect(root.textContent).not.toMatch(/Remember me/);
});

test("hides client encryption while Shared computer is ticked", () => {
  const onSubmit = mount({ clientEncryption: true });
  const encrypt = "Encrypt local data on this device";
  expect(checkbox(encrypt)).not.toBeNull();
  tick(checkbox(encrypt)!);
  tick(checkbox(SHARED_LABEL)!);
  expect(checkbox(encrypt)).toBeNull();
  submit();
  expect(onSubmit.mock.calls[0][0].clientEncryption).toBe(false);
});
