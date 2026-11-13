import { h } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import {
  Button,
  Input,
  Progress,
  SegmentedControl,
  Tabs,
  UrlPrefixInput,
} from "./index.ts";

test("Button primary emits both classes and merges consumer class", () => {
  const html = render(h(Button, { variant: "primary", class: "x" }, "Ok"));
  expect(html).toContain("sb-button sb-button-primary x");
  expect(html).toContain(">Ok</button>");
  expect(html).toContain('type="button"');
});

test("Input renders cleanly when onConfirm/onExit are provided", () => {
  const html = render(
    h(Input, { value: "hi", onConfirm: () => {}, onExit: () => {} }),
  );
  expect(html).toContain('class="sb-input"');
  expect(html).toContain('value="hi"');
  // Callback props must not leak as DOM attributes
  expect(html).not.toContain("onConfirm");
  expect(html).not.toContain("onExit");
});

test("Tabs marks the active tab and wires per-item onSelect", () => {
  let picked = "";
  const items = [
    { label: "A", active: false, onSelect: () => (picked = "a") },
    { label: "B", active: true, onSelect: () => (picked = "b") },
  ];
  const html = render(h(Tabs, { items }));
  expect(html).toContain("sb-tab sb-active");
  expect(html).toContain('aria-selected="true"');
  items[0].onSelect();
  expect(picked).toBe("a");
});

test("Progress clamps value to a width percentage", () => {
  expect(render(h(Progress, { value: 0.5 }))).toMatch(/width:\s*50%/);
  expect(render(h(Progress, { value: 2 }))).toMatch(/width:\s*100%/);
  expect(render(h(Progress, { value: -1 }))).toMatch(/width:\s*0%/);
});

test("UrlPrefixInput shows the origin it is given, not the ambient one", () => {
  // The desktop app configures a *remote* sync server, so the origin cannot
  // be read from `location` the way the server-hosted Dashboard does.
  const html = render(
    h(UrlPrefixInput, {
      origin: "https://sb.example.com",
      value: "/notes",
      onInput: () => {},
    }),
  );
  expect(html).toContain("sb-url-input");
  expect(html).toContain(">https://sb.example.com</span>");
  expect(html).toContain('value="/notes"');
});

test("SegmentedControl defaults to tabIndex -1, so a caller's own input keeps focus", () => {
  const items = [{ label: "Pages" }, { label: "Meta" }];
  const html = render(
    h(SegmentedControl, { items, activeIndex: 0, onPick: () => {} }),
  );
  expect(html).toContain('tabindex="-1"');
  expect(html).not.toContain('tabindex="0"');
});

test("SegmentedControl takeFocus makes items ordinary tab stops", () => {
  const items = [{ label: "A" }];
  const html = render(
    h(SegmentedControl, {
      items,
      activeIndex: 0,
      onPick: () => {},
      takeFocus: true,
    }),
  );
  expect(html).toContain('tabindex="0"');
});

test("SegmentedControl marks the active item and defaults aria-label to Options", () => {
  const items = [{ label: "A" }, { label: "B" }];
  const html = render(
    h(SegmentedControl, { items, activeIndex: 1, onPick: () => {} }),
  );
  expect(html).toContain("sb-segment sb-segment-active");
  expect(html).toContain('aria-label="Options"');
});

test("SegmentedControl prefers the caller's tooltip over the label", () => {
  const items = [{ label: "Anchors", tooltip: "Anchors ($)" }];
  const html = render(
    h(SegmentedControl, { items, activeIndex: 0, onPick: () => {} }),
  );
  expect(html).toContain('title="Anchors ($)"');
});

test("UrlPrefixInput trims a trailing slash off the origin", () => {
  // Sync server URLs are commonly stored with one; without trimming the
  // assembled URL reads "https://h//notes".
  const html = render(
    h(UrlPrefixInput, {
      origin: "https://sb.example.com/",
      value: "/notes",
      onInput: () => {},
    }),
  );
  expect(html).toContain(">https://sb.example.com</span>");
});
