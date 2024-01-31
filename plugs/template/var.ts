import { CompleteEvent } from "$sb/app_event.ts";
import { events } from "$sb/syscalls.ts";

import {
  AttributeCompleteEvent,
  AttributeCompletion,
} from "../index/attributes.ts";
import { attributeCompletionsToCMCompletion } from "./snippet.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";

export async function templateVariableComplete(completeEvent: CompleteEvent) {
  // Check if we're in a query, block or template context
  const fencedParent = completeEvent.parentNodes.find((node) =>
    node.startsWith("FencedCode:query") ||
    node.startsWith("FencedCode:template")
  );

  if (!fencedParent) {
    return null;
  }

  const match = /(@|\{\{)(\w*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  let allCompletions: any[] = [];

  if (match[1] !== "@") {
    // Not a variable
    // Function completions
    allCompletions = Object.keys(builtinFunctions).map(
      (name) => ({ label: name, detail: "function" }),
    );

    // Attribute completions
    const completions = (await events.dispatchEvent(
      `attribute:complete:_`,
      {
        source: "",
        prefix: match[2],
      } as AttributeCompleteEvent,
    )).flat() as AttributeCompletion[];

    allCompletions = allCompletions.concat(
      attributeCompletionsToCMCompletion(completions),
    );
  }

  const allVariables = [...fencedParent.match(/@(\w+)/g) || []];
  allVariables.push("@page");
  allCompletions = allCompletions.concat(
    allVariables.filter((v) => v !== match[0]).map((key) => ({
      label: key,
      apply: key.substring(1),
      detail: "variable",
    })),
  );

  return {
    from: completeEvent.pos - match[2].length,
    options: allCompletions,
  };
}
