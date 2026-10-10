// @vitest-environment happy-dom
import { createElement, render } from "preact";
import { act } from "preact/test-utils";
import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import { afterEach, expect, test, vi } from "vitest";
import { ViewActionsMenu } from "./view_actions_menu.tsx";

afterEach(() => {
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  document.body.replaceChildren();
});

const definition = {
  path: "Test/Page.md" as Path,
  details: { type: "position" as const, pos: 7 },
};

function mount(props: Parameters<typeof ViewActionsMenu>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  void act(() => render(createElement(ViewActionsMenu, props), host));
  return host;
}

const items = () =>
  [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent);

test("a view with no actions has no ⋯ button", () => {
  const host = mount({ client: { navigate: vi.fn() } });
  expect(host.querySelector("button")).toBeNull();
});

test("the ⋯ menu offers Go to definition, then Copy as Markdown", () => {
  const navigate = vi.fn(async () => {});
  const copy = vi.fn(async () => {});
  const host = mount({ client: { navigate }, definition, copy });
  host.querySelector<HTMLButtonElement>("button")!.click();
  expect(items()).toEqual(["Go to definition", "Copy as Markdown"]);
  document.querySelector<HTMLButtonElement>('[data-action="copy"]')!.click();
  expect(copy).toHaveBeenCalledOnce();
  expect(document.querySelector("[role=menu]")).toBeNull();
  host.querySelector<HTMLButtonElement>("button")!.click();
  document
    .querySelector<HTMLButtonElement>('[data-action="definition"]')!
    .click();
  expect(navigate).toHaveBeenCalledWith(definition);
});

test("only the actions a view has are offered", () => {
  const host = mount({ client: { navigate: vi.fn() }, copy: vi.fn() });
  host.querySelector<HTMLButtonElement>("button")!.click();
  expect(items()).toEqual(["Copy as Markdown"]);
});

test("unmounting closes an open ⋯ menu", () => {
  const host = mount({ client: { navigate: vi.fn() }, definition });
  host.querySelector<HTMLButtonElement>("button")!.click();
  expect(document.querySelector("[role=menu]")).not.toBeNull();
  void act(() => render(null, host));
  expect(document.querySelector("[role=menu]")).toBeNull();
});
