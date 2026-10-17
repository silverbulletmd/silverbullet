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
    clientSystem: { localSyscall: vi.fn(async (): Promise<any> => "x") },
    ui: { flashNotification: vi.fn() },
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

test("Alt-click does not activate links or commands inside a source widget", () => {
  const client = fakeClient();
  const div = widget(
    '<span><a data-ref="Other" href="/Other">Other</a>' +
      `<button data-onclick='${JSON.stringify(["command", "Fixture: Run", []])}'>Run</button></span>`,
  );
  attachWidgetEventHandlers(
    div.firstElementChild as HTMLElement,
    client as unknown as Client,
  );
  attachWidgetEventHandlers(div, client as unknown as Client, "${fixture()}");

  expect(click(div.querySelector("a")!, { altKey: true })).toBe(false);
  expect(click(div.querySelector("button")!, { altKey: true })).toBe(false);
  expect(client.navigate).not.toHaveBeenCalled();
  expect(client.runCommandByName).not.toHaveBeenCalled();
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
  await vi.waitFor(() => expect(box.dataset.state).toBe("x"));
  expect(client.clientSystem.localSyscall).toHaveBeenCalledWith(
    "system.invokeFunction",
    ["index.updateTaskState", "Tasks@4", " ", "x"],
  );

  const state = div.querySelector<HTMLElement>(".sb-task-state")!;
  expect(state.style.cursor).toBe("pointer");
  click(state);
  await vi.waitFor(() => expect(state.textContent).toBe("x"));
  expect(client.clientSystem.localSyscall).toHaveBeenCalledWith(
    "system.invokeFunction",
    ["index.cycleTaskStateByRef", "Tasks@9", "TODO"],
  );

  expect(div.querySelector(".plain")!.hasAttribute("disabled")).toBe(true);
});

const stateRow = (ref: string, state: string) =>
  `<span data-external-task-ref="${ref}"><span class="sb-task-state" data-task-state="${state}">${state}</span></span>`;

test("a click on a task state waits for the save before it and starts from its result", async () => {
  const client = fakeClient();
  const saves: ((newState: string) => void)[] = [];
  client.clientSystem.localSyscall.mockImplementation(
    () => new Promise((resolve) => saves.push(resolve)),
  );
  const div = widget(stateRow("Tasks@0", "TODO"));
  attachWidgetEventHandlers(div, client as unknown as Client);
  const state = div.querySelector<HTMLElement>(".sb-task-state")!;

  click(state);
  click(state);
  await vi.waitFor(() => expect(saves).toHaveLength(1));
  saves[0]("READY");
  await vi.waitFor(() => expect(saves).toHaveLength(2));

  expect(client.clientSystem.localSyscall).toHaveBeenLastCalledWith(
    "system.invokeFunction",
    ["index.cycleTaskStateByRef", "Tasks@0", "READY"],
  );
  saves[1]("IN PROGRESS");
  await vi.waitFor(() => expect(state.textContent).toBe("IN PROGRESS"));
});

test("a saved state of a new length moves the refs of later tasks on the same page", async () => {
  const client = fakeClient();
  client.clientSystem.localSyscall.mockImplementation(
    async () => "IN PROGRESS",
  );
  const first = widget(
    stateRow("Tasks@0", "TODO") +
      stateRow("Tasks@20", "TODO") +
      stateRow("Other@30", "TODO"),
  );
  const second = widget(stateRow("Tasks@40", "TODO"));
  attachWidgetEventHandlers(first, client as unknown as Client);
  attachWidgetEventHandlers(second, client as unknown as Client);
  const refs = () =>
    [...document.querySelectorAll<HTMLElement>("[data-external-task-ref]")].map(
      (el) => el.dataset.externalTaskRef,
    );

  click(first.querySelector(".sb-task-state")!);
  await vi.waitFor(() =>
    expect(refs()).toEqual(["Tasks@0", "Tasks@27", "Other@30", "Tasks@47"]),
  );
});

test("a task whose ref has gone stale keeps its state, and the user is told", async () => {
  const client = fakeClient();
  client.clientSystem.localSyscall.mockImplementation(async () => undefined);
  const div = widget(
    stateRow("Tasks@0", "TODO") +
      '<span data-external-task-ref="Tasks@20"><input type="checkbox" data-state=" "></span>',
  );
  attachWidgetEventHandlers(div, client as unknown as Client);
  const state = div.querySelector<HTMLElement>(".sb-task-state")!;
  const box = div.querySelector<HTMLInputElement>("input")!;

  click(state);
  box.click();
  await vi.waitFor(() =>
    expect(client.ui.flashNotification).toHaveBeenCalledTimes(2),
  );
  expect(state.textContent).toBe("TODO");
  expect(state.dataset.taskState).toBe("TODO");
  expect(box.checked).toBe(false);
  expect(box.dataset.state).toBe(" ");
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
