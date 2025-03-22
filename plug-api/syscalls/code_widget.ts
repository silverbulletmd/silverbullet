import { syscall } from "../syscall.ts";

/**
 * Refreshes all code widgets on the page that support it.
 */
export function refreshAll(): Promise<void> {
  return syscall("codeWidget.refreshAll");
}
