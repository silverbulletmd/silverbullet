import { h, type VNode } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { RowActions, type RowActionsProps } from "./row_actions.tsx";
import type { RowMenuItem, RowMenuProps } from "./row_menu.tsx";

const actions = [{ label: "Open", hasWhen: false }];
const two = [
  { label: "Rename", hasWhen: false },
  { label: "Delete", hasWhen: false },
];

type WrapperProps = {
  onKeyDown?: (event: { stopPropagation(): void }) => void;
  onMouseDown?: (event: { preventDefault(): void }) => void;
  children: VNode<RowMenuProps>;
};

function wrapperFor(props: Partial<RowActionsProps>): VNode<WrapperProps> {
  return RowActions({
    actions,
    readOnly: false,
    onRun() {},
    ...props,
  }) as VNode<WrapperProps>;
}

function itemsFor(props: Partial<RowActionsProps>): RowMenuItem[] {
  return wrapperFor(props).props.children.props.items;
}

/** A per-action button would carry `sb-row-action` itself (not `-s`, `-icon`). */
const ACTION_BUTTON = /sb-row-action(?![s-])/;

test("renders a single menu trigger, not one button per action", () => {
  const html = render(
    h(RowActions, { actions: two, readOnly: false, onRun() {} }),
  );
  expect(html.match(/sb-row-menu-trigger/g)?.length).toBe(1);
  expect(html).not.toMatch(ACTION_BUTTON);
  expect(html).toContain('aria-label="Actions"');
});

test("menu items are the visible actions, running their own index", () => {
  const run: number[] = [];
  const icon = { nodeName: "svg" } as unknown as Element;
  const items = itemsFor({
    actions: [
      { label: "Open", hasWhen: false },
      { label: "Hidden", hasWhen: true },
      { label: "Delete", hasWhen: true },
    ],
    mask: [true, false, true],
    icons: [undefined, undefined, icon],
    onRun: (index) => run.push(index),
  });
  expect(items.map((item) => item.label)).toEqual(["Open", "Delete"]);
  expect(items[1].icon).toBe(icon);
  items[1].run();
  expect(run).toEqual([2]);
});

test("read-only hides rw actions from the menu, and no visible actions renders nothing", () => {
  expect(
    RowActions({
      actions: [{ label: "Delete", hasWhen: false, requireMode: "rw" }],
      readOnly: true,
      onRun() {},
    }),
  ).toBeNull();
  const items = itemsFor({
    actions: [
      { label: "Open", hasWhen: false },
      { label: "Delete", hasWhen: false, requireMode: "rw" },
    ],
    readOnly: true,
  });
  expect(items.map((item) => item.label)).toEqual(["Open"]);
});

test("disabled propagates to every item", () => {
  const items = itemsFor({ actions: two, disabled: true });
  expect(items.map((item) => item.disabled)).toEqual([true, true]);
  expect(itemsFor({ actions: two }).map((item) => !!item.disabled)).toEqual([
    false,
    false,
  ]);
});

test("the document menu trigger is in tab order and stops row keyboard handling", () => {
  const html = render(
    h(RowActions, { actions, readOnly: false, documentMode: true, onRun() {} }),
  );
  expect(html).toContain('tabindex="0"');
  const wrapper = wrapperFor({ documentMode: true });
  let stopped = 0;
  wrapper.props.onKeyDown?.({ stopPropagation: () => stopped++ });
  expect(stopped).toBe(1);
  expect(wrapper.props.onMouseDown).toBeUndefined();
});

test("the panel menu trigger keeps input focus and stays out of tab order", () => {
  const html = render(h(RowActions, { actions, readOnly: false, onRun() {} }));
  expect(html).toContain('tabindex="-1"');
  const wrapper = wrapperFor({});
  let prevented = 0;
  wrapper.props.onMouseDown?.({ preventDefault: () => prevented++ });
  expect(prevented).toBe(1);
  expect(wrapper.props.onKeyDown).toBeUndefined();
});
