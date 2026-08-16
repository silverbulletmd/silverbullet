/**
 * Whether a command whose `requireEditor` is `requiredEditor` may run given
 * `currentEditor`, the name of the document editor (if any) currently
 * active -- `undefined` for an ordinary markdown page. Shared by
 * `createCommandKeyBindings` and `boundChordManifest`, which must agree on
 * exactly which commands are live right now.
 */
export function isValidEditor(
  currentEditor: string | undefined,
  requiredEditor: string | undefined,
): boolean {
  return (
    requiredEditor === undefined ||
    (currentEditor === undefined && requiredEditor === "page") ||
    requiredEditor === "any" ||
    currentEditor === requiredEditor ||
    (currentEditor !== undefined && requiredEditor === "notpage")
  );
}
