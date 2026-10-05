import { createElement } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";
import type { Client } from "../../../client.ts";
import type { ViewMeta } from "../../types.ts";
import { PageWidgetFrame } from "./page_widget_frame.tsx";

const client: Pick<Client, "navigate"> = { navigate: async () => {} };

function frame(
  pending: boolean,
  loading: boolean,
  collapsed = false,
  meta: ViewMeta = { title: "Related pages" } as ViewMeta,
) {
  return renderToString(
    createElement(PageWidgetFrame, {
      name: "test-view",
      meta,
      client,
      slot: "page-bottom",
      pending,
      loading,
      collapsed,
      onToggleCollapsed: () => {},
      hasBody: true,
      children: "Previous result",
    }),
  );
}

test("a pending page widget keeps its content before the spinner delay", () => {
  const html = frame(true, false);
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("Previous result");
  expect(html).not.toContain('aria-label="Loading"');
});

test("a collapsed widget keeps the loading indicator in its header", () => {
  const html = frame(true, true, true);
  expect(html).toContain('aria-label="Loading"');
  expect(html).toContain('role="status"');
  expect(html).not.toContain("Previous result");
});

test("a settled widget removes its loading indicator and busy state", () => {
  const html = frame(false, false);
  expect(html).toContain('aria-busy="false"');
  expect(html).not.toContain('aria-label="Loading"');
  expect(html).toContain("Previous result");
});

test("a page widget shows Go to definition only when its source is known", () => {
  const without = frame(false, false);
  const withDefinition = frame(false, false, false, {
    ...({ title: "Related pages" } as ViewMeta),
    definition: {
      path: "Test/Page.md",
      details: { type: "position", pos: 42 },
    },
  });
  expect(without).not.toContain('aria-label="Go to definition"');
  expect(withDefinition).toContain(
    'class="sb-nav-definition" title="Go to definition" aria-label="Go to definition"',
  );
  expect(withDefinition.indexOf('aria-label="Go to definition"')).toBeLessThan(
    withDefinition.indexOf('aria-label="Close"'),
  );
});
