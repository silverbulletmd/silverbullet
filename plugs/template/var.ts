import { CompleteEvent } from "../../plug-api/types.ts";
import { datastore, events } from "$sb/syscalls.ts";

import {
  AttributeCompleteEvent,
  AttributeCompletion,
} from "../index/attributes.ts";
import { attributeCompletionsToCMCompletion } from "./snippet.ts";

export async function templateAttributeComplete(completeEvent: CompleteEvent) {
  // Check if we're in a query, block or template context
  const fencedParent = completeEvent.parentNodes.find((node) =>
    node.startsWith("FencedCode:template")
  );

  if (!fencedParent) {
    return null;
  }

  const attributeMatch = /(^|[^{])\{\{(\w*)$/.exec(completeEvent.linePrefix);
  if (!attributeMatch) {
    return null;
  }

  let allCompletions: any[] = [];

  // Function completions
  const functions = await datastore.listFunctions();
  allCompletions = functions.map((name) => ({
    label: name,
    apply: name,
    detail: "function",
  }));

  // Attribute completions
  const completions = (await events.dispatchEvent(
    `attribute:complete:_`,
    {
      source: "",
      prefix: attributeMatch[2],
    } as AttributeCompleteEvent,
  )).flat() as AttributeCompletion[];

  allCompletions = allCompletions.concat(
    attributeCompletionsToCMCompletion(completions),
  );

  return {
    from: completeEvent.pos - attributeMatch[2].length,
    options: allCompletions,
  };
}

export function templateVariableComplete(completeEvent: CompleteEvent) {
  // Check if we're in a query, block or template context
  const fencedParent = completeEvent.parentNodes.find((node) =>
    node.startsWith("FencedCode:template")
  );

  if (!fencedParent) {
    return null;
  }

  // Find a @ inside of a {{
  const variableMatch = /\{\{[^}]*@(\w*)$/.exec(completeEvent.linePrefix);
  if (!variableMatch) {
    return null;
  }

  let allCompletions: any[] = [];
  const regexp = /\s+@(\w+)\s+(=|in)\s+/g;
  const allVariables = new Set<string>();
  const matches = fencedParent.matchAll(regexp);
  for (const match of matches) {
    allVariables.add(match[1]);
  }

  allVariables.add("page");
  allCompletions = allCompletions.concat(
    [...allVariables].map((key) => ({
      label: `@${key}`,
      apply: key,
      detail: "variable",
    })),
  );

  return {
    from: completeEvent.pos - variableMatch[1].length,
    options: allCompletions,
  };
}
