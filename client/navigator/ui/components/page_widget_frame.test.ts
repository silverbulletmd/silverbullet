import { createElement } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";
import type { ViewMeta } from "../../types.ts";
import { PageWidgetFrame } from "./page_widget_frame.tsx";

function frame(pending: boolean, loading: boolean, collapsed = false) {
  return renderToString(
    createElement(PageWidgetFrame, {
      name: "test-view",
      meta: { title: "Related pages" } as ViewMeta,
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
