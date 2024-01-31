import { CompleteEvent } from "$sb/app_event.ts";
import { events, language } from "$sb/syscalls.ts";
import {
  AttributeCompleteEvent,
  AttributeCompletion,
} from "../index/attributes.ts";

export async function queryComplete(completeEvent: CompleteEvent) {
  let querySourceMatch: RegExpExecArray | null = null;

  // Let's check if this is a query block
  let fencedParent = completeEvent.parentNodes.find((node) =>
    node.startsWith("FencedCode:query")
  );
  if (fencedParent) {
    // Yep, let's see if we can do source completion
    querySourceMatch = /^\s*([\w\-_]*)$/.exec(
      completeEvent.linePrefix,
    );
  } else {
    // Not a query, perhaps a template then?
    fencedParent = completeEvent.parentNodes.find((node) =>
      node.startsWith("FencedCode:template")
    );

    if (fencedParent) {
      querySourceMatch = /\{(\s*[\w\-_]*)$/.exec(
        completeEvent.linePrefix,
      );
    } else {
      // No? Then we're out, sorry.
      return null;
    }
  }
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

  // If that doesn't work, let's try to match other bits of the query
  // For this we do need to find the query source, though, so let's look for it in fencedParent
  querySourceMatch = /(^[\n\r\s]*|\{\s*)([\w\-_]+)/.exec(
    fencedParent.slice("FencedCode:query".length),
  );
  const whereMatch =
    /(where|order\s+by|and|or|select(\s+[\w\s,]+)?)\s+([\w\-_]*)$/
      .exec(
        completeEvent.linePrefix,
      );
  if (querySourceMatch && whereMatch) {
    const type = querySourceMatch[2];
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

export async function languageComplete(completeEvent: CompleteEvent) {
  const languagePrefix = /^```(\w*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!languagePrefix) {
    return null;
  }

  const allLanguages = await language.listLanguages();
  return {
    from: completeEvent.pos - languagePrefix[1].length,
    options: allLanguages.map(
      (lang) => ({
        label: lang,
        type: "language",
      }),
    ),
  };
}
