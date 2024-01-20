import { CompleteEvent } from "$sb/app_event.ts";
import { PageMeta } from "$sb/types.ts";
import { events } from "$sb/syscalls.ts";
import { buildHandebarOptions } from "./util.ts";
import {
  AttributeCompleteEvent,
  AttributeCompletion,
} from "../index/attributes.ts";
import { attributeCompletionsToCMCompletion } from "./snippet.ts";

export async function templateVariableComplete(completeEvent: CompleteEvent) {
  const match = /\{\{([\w@]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  const handlebarOptions = buildHandebarOptions({ name: "" } as PageMeta);
  let allCompletions: any[] = Object.keys(handlebarOptions.helpers).map(
    (name) => ({ label: name, detail: "helper" }),
  );
  allCompletions = allCompletions.concat(
    Object.keys(handlebarOptions.data).map((key) => ({
      label: `@${key}`,
      detail: "global variable",
    })),
  );

  const completions = (await events.dispatchEvent(
    `attribute:complete:_`,
    {
      source: "",
      prefix: match[1],
    } as AttributeCompleteEvent,
  )).flat() as AttributeCompletion[];

  allCompletions = allCompletions.concat(
    attributeCompletionsToCMCompletion(completions),
  );

  return {
    from: completeEvent.pos - match[1].length,
    options: allCompletions,
  };
}
