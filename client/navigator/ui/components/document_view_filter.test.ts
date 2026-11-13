// @vitest-environment happy-dom
import { h, render } from "preact";
import { afterEach, expect, test, vi } from "vitest";
import type { Client } from "../../../client.ts";
import { EventInterest } from "../../../event_interest.ts";
import type { EventHook } from "../../../plugos/hooks/event.ts";
import type { Row, ViewMeta } from "../../types.ts";
import { DocumentView } from "./document_view.tsx";

vi.mock("./content_view.tsx", () => ({
  ContentNode: () => null,
  useRenderedValue: () => ({ content: undefined, current: false }),
}));
vi.mock("./row_markdown.tsx", () => ({
  MarkdownText: () => null,
  renderRowMarkdown: async () => null,
  renderRows: async (_client: unknown, rows: Row[]) =>
    rows.map((row) => ({ row })),
}));

const eventHook = {
  addLocalListener: () => {},
  removeLocalListener: () => {},
};
const client = {
  eventInterest: new EventInterest(eventHook as unknown as EventHook),
  isReadOnlyMode: () => false,
} as unknown as Client;

const table = {
  mode: "table",
  limit: 2,
  inlineFilter: true,
  hierarchy: { separator: "/" },
  foldersFirst: true,
  expandAll: false,
} as unknown as ViewMeta;

const row = (name: string): Row => ({ primary: name, obj: { name } }) as Row;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const names = (host: HTMLElement) =>
  [...host.querySelectorAll("tbody tr td:first-child")].map(
    (cell) => cell.textContent,
  );

async function mount(
  meta: ViewMeta,
  dispatch: (hook: string, args: any) => Promise<any>,
) {
  const host = document.createElement("div");
  document.body.append(host);
  render(
    h(DocumentView, {
      meta,
      client,
      pageName: "index",
      dock: "inline",
      dispatch,
      selectable: false,
    }),
    host,
  );
  await settle();
  return host;
}

async function type(host: HTMLElement, text: string) {
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Filter view"]',
  )!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("a client-filtered inline table filters before its limit", async () => {
  const dispatch = async (hook: string) =>
    hook === "rows" ? [row("Maple"), row("Cedar"), row("Birch")] : [];
  const host = await mount(table, dispatch);
  expect(names(host)).toEqual(["Maple", "Cedar"]);
  await type(host, "Birch");
  expect(names(host)).toEqual(["Birch"]);
});

test("a source-searched inline view passes the phrase to its source", async () => {
  const phrases: string[] = [];
  const dispatch = async (hook: string, args: any) => {
    if (hook !== "rows") return [];
    phrases.push(args.ctx.phrase);
    return args.ctx.phrase === "Owl" ? [row("Owl")] : [row("Owl"), row("Wren")];
  };
  const host = await mount(
    { ...table, limit: 20, search: "source" } as ViewMeta,
    dispatch,
  );
  expect(names(host)).toEqual(["Owl", "Wren"]);
  await type(host, "Owl");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(phrases.at(-1)).toBe("Owl");
  expect(names(host)).toEqual(["Owl"]);
});
