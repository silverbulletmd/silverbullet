export const REFRESH_TRIGGERS: Record<string, readonly string[]> = {
  index: ["file:changed", "file:deleted", "mq:emptyQueue:indexQueue"],
  navigate: ["editor:pageLoaded", "editor:documentLoaded"],
  edit: ["editor:pageModified"],
};

export function expandRefreshTriggers(entries: readonly string[]): string[] {
  const events = new Set<string>();
  for (const entry of entries) {
    const expanded = Object.hasOwn(REFRESH_TRIGGERS, entry)
      ? REFRESH_TRIGGERS[entry]
      : [entry];
    for (const event of expanded) events.add(event);
  }
  return [...events];
}
