import { type BuiltinView, baseMeta } from "./types.ts";

export const WORKBENCH_VIEW = "std.workbench";

/**
 * A shell for the Workbench: its body is registered with `registerNativeView`
 * (`client/workbench/commands.ts`), so the rows parts here stay empty.
 */
export const workbenchView: BuiltinView = {
  meta: baseMeta({
    title: "Workbench",
    noFilter: true,
    dock: "bhs",
    supportedDocks: ["bhs", "rhs", "lhs"],
    hasRowIcon: false,
  }),
  segments: [{ label: "Console", default: true }],
  row: {},
  source: () => Promise.resolve([]),
  onSelect: () => Promise.resolve(false),
};
