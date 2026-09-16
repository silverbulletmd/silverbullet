import { h, type VNode } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { RowActions, type RowActionsProps } from "./row_actions.tsx";

const actions = [{ label: "Open", hasWhen: false }];

type ButtonProps = {
  onKeyDown?: (event: { stopPropagation(): void }) => void;
  onMouseDown?: (event: { preventDefault(): void }) => void;
  onClick?: (event: { stopPropagation(): void }) => void;
};

function buttonFor(props: Partial<RowActionsProps>): VNode<ButtonProps> {
  const row = RowActions({
    actions,
    readOnly: false,
    onRun() {},
    ...props,
  });
  return (row!.props.children as VNode[])[0] as VNode<ButtonProps>;
}

test("document action buttons remain in tab order and can be disabled", () => {
  const html = render(
    h(RowActions, {
      actions,
      readOnly: false,
      documentMode: true,
      disabled: true,
      onRun() {},
    }),
  );
  expect(html).toContain('tabindex="0"');
  expect(html).toContain(" disabled");
});

test("document action buttons keep native focus and stop row keyboard handling", () => {
  const button = buttonFor({ documentMode: true });
  let stopped = 0;
  button.props.onKeyDown?.({ stopPropagation: () => stopped++ });
  expect(stopped).toBe(1);
  expect(button.props.onMouseDown).toBeUndefined();
});

test("panel action buttons keep input focus and stay out of tab order", () => {
  const html = render(h(RowActions, { actions, readOnly: false, onRun() {} }));
  expect(html).toContain('tabindex="-1"');
  const button = buttonFor({});
  let prevented = 0;
  button.props.onMouseDown?.({ preventDefault: () => prevented++ });
  expect(prevented).toBe(1);
  expect(button.props.onKeyDown).toBeUndefined();
});

test("document action clicks run the action without activating the row", () => {
  const run: number[] = [];
  const button = buttonFor({
    documentMode: true,
    onRun: (index) => run.push(index),
  });
  let stopped = 0;
  button.props.onClick?.({ stopPropagation: () => stopped++ });
  expect(stopped).toBe(1);
  expect(run).toEqual([0]);
});
