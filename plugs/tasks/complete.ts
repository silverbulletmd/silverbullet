import { CompleteEvent } from "../../plug-api/types.ts";
import { queryObjects } from "../index/plug_api.ts";
import { TaskStateObject } from "./task.ts";

export async function completeTaskState(completeEvent: CompleteEvent) {
  const taskMatch = /([\-\*]\s+\[)([^\[\]]+)$/.exec(
    completeEvent.linePrefix,
  );
  if (!taskMatch) {
    return null;
  }
  const allStates = await queryObjects<TaskStateObject>("taskstate", {}, 5);
  const states = [...new Set(allStates.map((s) => s.state))];

  return {
    from: completeEvent.pos - taskMatch[2].length,
    options: states.map((state) => ({
      label: state,
    })),
  };
}
