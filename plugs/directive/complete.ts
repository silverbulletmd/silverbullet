import { events } from "$sb/plugos-syscall/mod.ts";
import { CompleteEvent } from "$sb/app_event.ts";
import { buildHandebarOptions, handlebarHelpers } from "./util.ts";
import { PageMeta } from "../../web/types.ts";

export async function queryComplete(completeEvent: CompleteEvent) {
  const match = /#query ([\w\-_]+)*$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  const allEvents = await events.listEvents();

  return {
    from: completeEvent.pos - match[1].length,
    options: allEvents
      .filter((eventName) => eventName.startsWith("query:"))
      .map((source) => ({
        label: source.substring("query:".length),
      })),
  };
}

export function handlebarHelperComplete(completeEvent: CompleteEvent) {
  const match = /\{\{([\w@]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  const handlebarOptions = buildHandebarOptions({ name: "" } as PageMeta);
  const allCompletions = Object.keys(handlebarOptions.helpers).concat(
    Object.keys(handlebarOptions.data).map((key) => `@${key}`),
  );

  return {
    from: completeEvent.pos - match[1].length,
    options: allCompletions
      .map((name) => ({
        label: name,
      })),
  };
}
