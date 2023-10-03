import { CompleteEvent } from "$sb/app_event.ts";
import { events } from "$sb/syscalls.ts";
import {
  AttributeCompleteEvent,
  AttributeCompletion,
} from "../index/attributes.ts";

export async function queryComplete(completeEvent: CompleteEvent) {
  const fencedParent = completeEvent.parentNodes.find((node) =>
    node === "FencedCode:query"
  );
  if (!fencedParent) {
    return null;
  }
  let querySourceMatch = /^\s*([\w\-_]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (querySourceMatch) {
    const allEvents = await events.listEvents();

    const completionOptions = allEvents
      .filter((eventName) =>
        eventName.startsWith("query:") && !eventName.includes("*")
      )
      .map((source) => ({
        label: source.substring("query:".length),
      }));

    const allObjectTypes: string[] = (await events.dispatchEvent("query_", {}))
      .flat();

    for (const type of allObjectTypes) {
      completionOptions.push({
        label: type,
      });
    }

    return {
      from: completeEvent.pos - querySourceMatch[1].length,
      options: completionOptions,
    };
  }

  querySourceMatch = /^\s*([\w\-_]*)/.exec(
    completeEvent.linePrefix,
  );
  const whereMatch =
    /(where|order\s+by|and|or|select(\s+[\w\s,]+)?)\s+([\w\-_]*)$/
      .exec(
        completeEvent.linePrefix,
      );
  if (querySourceMatch && whereMatch) {
    const type = querySourceMatch[1];
    const attributePrefix = whereMatch[3];
    const completions = (await events.dispatchEvent(
      `attribute:complete:${type}`,
      {
        source: type,
        prefix: attributePrefix,
      } as AttributeCompleteEvent,
    )).flat() as AttributeCompletion[];
    return {
      from: completeEvent.pos - attributePrefix.length,
      options: attributeCompletionsToCMCompletion(completions),
    };
  }
  return null;
}

function attributeCompletionsToCMCompletion(
  completions: AttributeCompletion[],
) {
  return completions.map(
    (completion) => ({
      label: completion.name,
      detail: `${completion.attributeType} (${completion.source})`,
      type: "attribute",
    }),
  );
}
