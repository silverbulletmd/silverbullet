import { expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { attachWidgetEventHandlers } from "./widget_util.ts";

// This project's vitest run has no DOM, so the widget is a stand-in that
// answers the selectors attachWidgetEventHandlers looks for.
function fakeElement(dataset: Record<string, string> = {}) {
  const listeners: Record<string, (e: any) => void> = {};
  return {
    dataset,
    listeners,
    addEventListener: (type: string, fn: (e: any) => void) => {
      listeners[type] = fn;
    },
    querySelector: () => null,
  };
}

function fakeWidget(mentions: ReturnType<typeof fakeElement>[]) {
  const div = fakeElement();
  return Object.assign(div, {
    querySelectorAll: (selector: string) =>
      selector === "[data-mention-name]" ? mentions : [],
  });
}

test("clicking a mention in a widget opens the Mention Inbox on that recipient", () => {
  const mention = fakeElement({ mentionName: "Hana" });
  const client = { openNavigatorView: vi.fn() } as unknown as Client;
  attachWidgetEventHandlers(fakeWidget([mention]) as any, client);

  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  mention.listeners.click(event);

  expect(client.openNavigatorView).toHaveBeenCalledWith("inbox", {
    dropdown: "@hana",
    focus: false,
  });
  expect(event.preventDefault).toHaveBeenCalled();
});
