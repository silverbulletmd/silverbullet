import { describe, expect, test } from "vitest";
import {
  type ConfiguredActionButton,
  visibleActionButtons,
} from "./action_buttons.ts";

const btn = (
  over: Partial<ConfiguredActionButton> = {},
): ConfiguredActionButton => ({
  icon: "home",
  ...over,
});
const ctx = { isMobile: false, isStandalone: false, accountManaged: false };

describe("visibleActionButtons", () => {
  test("drops buttons with no icon", () => {
    expect(visibleActionButtons([btn({ icon: "" })], ctx)).toEqual([]);
  });

  test("keeps a button with no conditions", () => {
    expect(visibleActionButtons([btn()], ctx)).toHaveLength(1);
  });

  test("mobile and standalone still filter as before", () => {
    expect(visibleActionButtons([btn({ mobile: true })], ctx)).toEqual([]);
    expect(visibleActionButtons([btn({ mobile: false })], ctx)).toHaveLength(1);
    expect(visibleActionButtons([btn({ standalone: true })], ctx)).toEqual([]);
  });

  test("accountManaged drops a button the boot config disagrees with", () => {
    expect(visibleActionButtons([btn({ accountManaged: true })], ctx)).toEqual(
      [],
    );
    expect(
      visibleActionButtons([btn({ accountManaged: true })], {
        ...ctx,
        accountManaged: true,
      }),
    ).toHaveLength(1);
  });

  test("accountManaged false hides the button on an account-managed server", () => {
    expect(
      visibleActionButtons([btn({ accountManaged: false })], {
        ...ctx,
        accountManaged: true,
      }),
    ).toEqual([]);
  });

  test("sorts by explicit priority, highest first, before falling back to order", () => {
    const out = visibleActionButtons(
      [btn({ icon: "a", priority: 1 }), btn({ icon: "b", priority: 5 })],
      ctx,
    );
    expect(out.map((b) => b.icon)).toEqual(["b", "a"]);
  });
});
