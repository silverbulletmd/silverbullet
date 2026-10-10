// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import { attachWidgetEventHandlers } from "./widget_util.ts";

afterEach(() => {
  document.body.replaceChildren();
});

function fakeClient() {
  return {
    navigate: vi.fn(async () => {}),
    openNavigatorView: vi.fn(),
    runCommandByName: vi.fn(async () => {}),
    clientSystem: { localSyscall: vi.fn(async () => "x") },
  };
}

function widget(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.append(div);
  return div;
}

const click = (el: Element, init: MouseEventInit = {}) =>
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
  );

test("clicking a mention in a widget opens the Mention Inbox on that recipient", () => {
  const client = fakeClient();
  const div = widget('<span data-mention-name="Hana">@Hana</span>');
  attachWidgetEventHandlers(div, client as unknown as Client);

  const notCancelled = click(div.querySelector("[data-mention-name]")!);

  expect(client.openNavigatorView).toHaveBeenCalledWith("inbox", {
    dropdown: "@hana",
    focus: false,
  });
  expect(notCancelled).toBe(false);
});

test("a wiki link navigates locally, in a new window with a modifier", () => {
  const client = fakeClient();
  const div = widget(
    '<p><a href="/Other" data-ref="Other"><b>Other</b></a></p>',
  );
  attachWidgetEventHandlers(div, client as unknown as Client);

  click(div.querySelector("b")!);
  click(div.querySelector("a")!, { metaKey: true });

  expect(client.navigate).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ path: "Other.md" }),
    false,
    false,
  );
  expect(client.navigate).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ path: "Other.md" }),
    false,
    true,
  );
});

test("content moved into another widget keeps one handler and holds no listeners of its own", () => {
  const client = fakeClient();
  const content = document.createElement("p");
  content.innerHTML = '<a href="/Other" data-ref="Other">Other</a>';
  const first = widget("");
  first.append(content);
  attachWidgetEventHandlers(first, client as unknown as Client);
  const second = widget("");
  second.append(content);
  attachWidgetEventHandlers(second, client as unknown as Client);

  click(content.querySelector("a")!);
  expect(client.navigate).toHaveBeenCalledOnce();

  // Detached, the content no longer navigates: nothing is bound to it
  content.remove();
  click(content.querySelector("a")!);
  expect(client.navigate).toHaveBeenCalledOnce();
});

test("a command button runs its command", () => {
  const client = fakeClient();
  const div = widget(
    `<button data-onclick='${JSON.stringify(["command", "Fixture: Run", [1]])}'>Run</button>`,
  );
  attachWidgetEventHandlers(div, client as unknown as Client);
  click(div.querySelector("button")!);
  expect(client.runCommandByName).toHaveBeenCalledWith("Fixture: Run", [1]);
});

test("an external task's checkbox and state toggle through the index", async () => {
  const client = fakeClient();
  const div = widget(
    '<span data-external-task-ref="Tasks@4"><input type="checkbox" data-state=" "></span>' +
      '<span data-external-task-ref="Tasks@9"><span class="sb-task-state" data-task-state="TODO">TODO</span></span>' +
      '<input type="checkbox" class="plain">',
  );
  attachWidgetEventHandlers(div, client as unknown as Client);

  const box = div.querySelector<HTMLInputElement>(
    "[data-external-task-ref] input",
  )!;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  expect(client.clientSystem.localSyscall).toHaveBeenCalledWith(
    "system.invokeFunction",
    ["index.updateTaskState", "Tasks@4", " ", "x"],
  );
  expect(box.dataset.state).toBe("x");

  const state = div.querySelector<HTMLElement>(".sb-task-state")!;
  expect(state.style.cursor).toBe("pointer");
  click(state);
  expect(client.clientSystem.localSyscall).toHaveBeenCalledWith(
    "system.invokeFunction",
    ["index.cycleTaskStateByRef", "Tasks@9", "TODO"],
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(state.textContent).toBe("x");

  expect(div.querySelector(".plain")!.hasAttribute("disabled")).toBe(true);
});

test("Alt-click on a task state is left to cursor positioning", () => {
  const client = fakeClient();
  const div = widget(
    '<span data-external-task-ref="Tasks@9"><span class="sb-task-state" data-task-state="TODO">TODO</span></span>',
  );
  attachWidgetEventHandlers(div, client as unknown as Client);
  click(div.querySelector(".sb-task-state")!, { altKey: true });
  expect(client.clientSystem.localSyscall).not.toHaveBeenCalled();
});
