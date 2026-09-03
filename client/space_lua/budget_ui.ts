import { KEEP_GOING_MS, type LuaBudget } from "./budget.ts";

export type BudgetNotifier = {
  flashNotification(
    message: string,
    type?: string,
    options?: {
      timeout?: number;
      actions?: { name: string; run: () => void }[];
    },
  ): void;
};

export function offerStopNotification(
  ui: BudgetNotifier,
  message: string,
  budget: LuaBudget,
  onStop?: () => void,
): void {
  ui.flashNotification(message, "warning", {
    timeout: 0,
    actions: [
      {
        name: "Stop",
        run: () => {
          // The script may have finished running (this toast is persistent)
          // between the limit tripping and the user clicking Stop; don't
          // quarantine a script that isn't running anymore.
          if (budget.finished) {
            return;
          }
          budget.stopped = true;
          onStop?.();
        },
      },
      {
        name: "Keep going",
        run: () => {
          budget.busyLimitMs = budget.busyMs + KEEP_GOING_MS;
          // Resetting to 0 would restore the 500ms first-yield threshold,
          // making the tab unresponsive again right after the user asked
          // to continue.
          budget.yieldCount = 1;
          budget.limitReported = false;
        },
      },
    ],
  });
}
