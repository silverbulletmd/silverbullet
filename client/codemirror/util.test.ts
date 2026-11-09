import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import type { Client, PageListSource } from "../client.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { widgetRenderMode } from "./util.ts";

function clientWith(state: {
  systemReady?: boolean;
  scriptsLoaded?: boolean;
  pageListSource?: PageListSource;
  renderWidgets?: boolean;
}): Client {
  return {
    systemReady: state.systemReady ?? true,
    clientSystem: { scriptsLoaded: state.scriptsLoaded ?? true },
    // A cold client: no index yet, page list from the plain file listing
    fullIndexCompleted: false,
    pageListSource: state.pageListSource ?? "listing",
    currentPageMeta: () =>
      state.renderWidgets === undefined
        ? { name: "index" }
        : {
            name: "index",
            pageDecoration: { renderWidgets: state.renderWidgets },
          },
  } as unknown as Client;
}

const page = (text: string) =>
  EditorState.create({
    doc: text,
    extensions: [buildExtendedMarkdownLanguage()],
  });
const plain = page("Body");

test("widgets render from the fallback page list before the full index", () => {
  expect(widgetRenderMode(clientWith({}), plain)).toBe("ready");
});

test("widgets wait for the system, scripts and a page list", () => {
  expect(widgetRenderMode(clientWith({ systemReady: false }), plain)).toBe(
    "loading",
  );
  expect(widgetRenderMode(clientWith({ scriptsLoaded: false }), plain)).toBe(
    "loading",
  );
  expect(widgetRenderMode(clientWith({ pageListSource: "none" }), plain)).toBe(
    "loading",
  );
});

test("a page decoration can still disable widget rendering", () => {
  expect(widgetRenderMode(clientWith({ renderWidgets: false }), plain)).toBe(
    "disabled",
  );
  expect(
    widgetRenderMode(
      clientWith({ renderWidgets: false, systemReady: false }),
      plain,
    ),
  ).toBe("disabled");
});

test("before the index, the page's own frontmatter can disable widgets", () => {
  const optedOut = page(
    "---\npageDecoration:\n  renderWidgets: false\n---\n${1 + 1}",
  );
  expect(widgetRenderMode(clientWith({}), optedOut)).toBe("disabled");
  expect(
    widgetRenderMode(clientWith({}), page("---\ntags: x\n---\nBody")),
  ).toBe("ready");
  expect(widgetRenderMode(clientWith({}), page("---\n: [\n---\nBody"))).toBe(
    "ready",
  );
  // Once the page list is index-backed, the page meta is the authority
  expect(
    widgetRenderMode(clientWith({ pageListSource: "index" }), optedOut),
  ).toBe("ready");
});
