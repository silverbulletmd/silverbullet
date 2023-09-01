import { CompleteEvent } from "$sb/app_event.ts";
import { index } from "$sb/syscalls.ts";

export async function completeTaskState(completeEvent: CompleteEvent) {
  const taskMatch = /([\-\*]\s+\[)([^\[\]]+)$/.exec(
    completeEvent.linePrefix,
  );
  if (!taskMatch) {
    return null;
  }
  const allStates = await index.queryPrefix("taskState:");
  const states = [...new Set(allStates.map((s) => s.key.split(":")[1]))];

  return {
    from: completeEvent.pos - taskMatch[2].length,
    options: states.map((state) => ({
      label: state,
    })),
  };
}
