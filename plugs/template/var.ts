import { CompleteEvent } from "$sb/app_event.ts";
import { events } from "$sb/syscalls.ts";

import {
  AttributeCompleteEvent,
  AttributeCompletion,
} from "../index/attributes.ts";
import { attributeCompletionsToCMCompletion } from "./snippet.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";

export async function templateVariableComplete(completeEvent: CompleteEvent) {
  const match = /\{\{([\w@]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  let allCompletions: any[] = Object.keys(builtinFunctions).map(
    (name) => ({ label: name, detail: "helper" }),
  );
  allCompletions = allCompletions.concat(
    ["page"].map((key) => ({
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
