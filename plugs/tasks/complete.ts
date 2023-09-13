import { CompleteEvent } from "$sb/app_event.ts";
import { queryObjects } from "../index/plug_api.ts";

export async function completeTaskState(completeEvent: CompleteEvent) {
  const taskMatch = /([\-\*]\s+\[)([^\[\]]+)$/.exec(
    completeEvent.linePrefix,
  );
  if (!taskMatch) {
    return null;
  }
  const allStates = await queryObjects("taskstate", {});
  const states = [...new Set(allStates.map((s) => s.value.state))];

  return {
    from: completeEvent.pos - taskMatch[2].length,
    options: states.map((state) => ({
      label: state,
    })),
  };
}
