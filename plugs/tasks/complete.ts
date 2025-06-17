import { queryLuaObjects } from "../index/api.ts";
import type { TaskStateObject } from "./task.ts";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";

export async function completeTaskState(completeEvent: CompleteEvent) {
  const taskMatch = /([\-\*]\s+\[)([^\[\]]+)$/.exec(
    completeEvent.linePrefix,
  );
  if (!taskMatch) {
    return null;
  }
  const allStates = await queryLuaObjects<TaskStateObject>(
    "taskstate",
    {},
    {},
    5,
  );
  const states = [...new Set(allStates.map((s) => s.state))];

  return {
    from: completeEvent.pos - taskMatch[2].length,
    options: states.map((state) => ({
      label: state,
    })),
  };
}
