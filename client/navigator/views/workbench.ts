import { type BuiltinView, baseMeta } from "./types.ts";

export const WORKBENCH_VIEW = "std.workbench";

/** The Workbench's tabs, in order; each swaps the whole body (`client/workbench/ui/workbench.tsx`). */
export const WORKBENCH_TABS = [
  "Overview",
  "Query",
  "Console",
  "Scripts",
  "Styles",
  "Health",
] as const;
export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

/** Opens a page's `query[[…]]` in the Query tab's query editor (`client/workbench/query_open.ts`) */
export const EDIT_QUERY_COMMAND = "Workbench: Edit Query";

/**
 * A shell for the Workbench: its body is registered with `registerNativeView`
 * (`client/workbench/commands.ts`), so the rows parts here stay empty.
 */
export const workbenchView: BuiltinView = {
  meta: baseMeta({
    title: "Workbench",
    noFilter: true,
    dock: "bhs",
    supportedDocks: ["bhs", "rhs", "lhs", "modal"],
    hasRowIcon: false,
  }),
  segments: WORKBENCH_TABS.map((label, i) => ({ label, default: i === 0 })),
  row: {},
  source: () => Promise.resolve([]),
  onSelect: () => Promise.resolve(false),
};
