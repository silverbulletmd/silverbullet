/**
 * What `GET api/admin/server-info` reports under `runtimeApi`. Server-wide and
 * resolved at server boot, so it is not part of any space's own config.
 */
export type RuntimeAvailability =
  | { status: "available" }
  | { status: "no_chrome" }
  | { status: "disabled_by_env" }
  | { status: "failed"; message: string };

/**
 * The note shown beside a locked "Enable runtime API" checkbox, or `null` when
 * the checkbox should stay usable — either because the runtime is available,
 * or because we do not know yet (the fetch is in flight or failed).
 */
export function runtimeApiUnavailableReason(
  availability: RuntimeAvailability | null,
): string | null {
  switch (availability?.status) {
    case "no_chrome":
      return "No Chrome or Chromium found on this server.";
    case "disabled_by_env":
      return "Disabled server-wide by SB_RUNTIME_API=0.";
    case "failed":
      return `Unavailable: ${availability.message}`;
    default:
      return null;
  }
}
