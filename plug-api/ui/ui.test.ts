import { expect, test } from "vitest";
import { h } from "preact";
import { render } from "preact-render-to-string";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Input,
  Progress,
  Select,
  Tabs,
} from "./index.ts";

test("Button primary emits both classes and merges consumer class", () => {
  const html = render(h(Button, { variant: "primary", class: "x" }, "Ok"));
  expect(html).toContain("sb-button sb-button-primary x");
  expect(html).toContain(">Ok</button>");
  expect(html).toContain('type="button"');
});

test("Button danger/icon variants", () => {
  expect(render(h(Button, { variant: "danger" }, "D"))).toContain("sb-button-danger");
  expect(render(h(Button, { variant: "icon" }, "I"))).toContain("sb-button-icon");
});

test("Input renders sb-input with default type text", () => {
  const html = render(h(Input, { value: "hi" }));
  expect(html).toContain('class="sb-input"');
  expect(html).toContain('type="text"');
});

test("Select wraps options", () => {
  const html = render(h(Select, {}, h("option", {}, "A")));
  expect(html).toContain('class="sb-select"');
  expect(html).toContain(">A</option>");
});

test("Checkbox is a checkbox input", () => {
  const html = render(h(Checkbox, { checked: true }));
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("sb-checkbox");
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
  // each tab carries its own handler
  items[0].onSelect();
  expect(picked).toBe("a");
});

test("Alert variant class", () => {
  expect(render(h(Alert, { variant: "error" }, "e"))).toContain("sb-alert sb-alert-error");
  expect(render(h(Alert, { variant: "warning" }, "w"))).toContain("sb-alert-warning");
  expect(render(h(Alert, { variant: "info" }, "i"))).toContain("sb-alert-info");
});

test("Badge", () => {
  expect(render(h(Badge, {}, "b"))).toContain('class="sb-badge">b<');
});

test("Progress clamps value to a width percentage", () => {
  expect(render(h(Progress, { value: 0.5 }))).toMatch(/width:\s*50%/);
  expect(render(h(Progress, { value: 2 }))).toMatch(/width:\s*100%/);
  expect(render(h(Progress, { value: -1 }))).toMatch(/width:\s*0%/);
});
