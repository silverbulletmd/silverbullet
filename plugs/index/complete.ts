import { config } from "@silverbulletmd/silverbullet/syscalls";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";

export async function completeTaskState(completeEvent: CompleteEvent) {
  const taskMatch = /([\-\*]\s+\[)([^\[\]]+)$/.exec(
    completeEvent.linePrefix,
  );
  if (!taskMatch) {
    return null;
  }
  const allStates = Object.keys(await config.get("taskStates", {}));

  return {
    from: completeEvent.pos - taskMatch[2].length,
    options: allStates.map((state) => ({
      label: state,
    })),
  };
}
