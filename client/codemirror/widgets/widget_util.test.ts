// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import {
  attachWidgetEventHandlers,
  buildTranslateUrls,
} from "./widget_util.ts";

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

test("translated urls unwrap angle-bracket destinations", () => {
  const translate = buildTranslateUrls({
    currentName: () => "Folder/Current",
  } as Client);
  expect(translate("<https://example.com/a>")).toBe("https://example.com/a");
  expect(translate("<zotero://select/library/items/ABC>")).toBe(
    "zotero://select/library/items/ABC",
  );
  expect(translate("<My Page>")).toBe("Folder/My Page");
  expect(translate("https://example.com/a")).toBe("https://example.com/a");
});

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
      '<input type="checkbox" class="plain" data-state=" ">',
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

test("a checkbox built without data-state stays enabled", () => {
  const client = fakeClient();
  const div = widget(
    '<input type="checkbox" class="live"><input type="checkbox" class="md" data-state=" ">',
  );
  attachWidgetEventHandlers(div, client as unknown as Client);
  expect(div.querySelector(".live")!.hasAttribute("disabled")).toBe(false);
  expect(div.querySelector(".md")!.hasAttribute("disabled")).toBe(true);
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
