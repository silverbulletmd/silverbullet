import type { CompleteEvent } from "$sb/app_event.ts";
import { events } from "$sb/syscalls.ts";
import { getObjectByRef, queryObjects } from "./api.ts";
import { ObjectValue, QueryExpression } from "$sb/types.ts";
import { builtinPseudoPage } from "./builtins.ts";

export type AttributeObject = ObjectValue<{
  name: string;
  attributeType: string;
  tag: string;
  page: string;
}>;

export type AttributeCompleteEvent = {
  source: string;
  prefix: string;
};

export type AttributeCompletion = {
  name: string;
  source: string;
  attributeType: string;
  builtin?: boolean;
};

export function determineType(v: any): string {
  const t = typeof v;
  if (t === "object") {
    if (Array.isArray(v)) {
      return "array";
    }
  }
  return t;
}

export async function objectAttributeCompleter(
  attributeCompleteEvent: AttributeCompleteEvent,
): Promise<AttributeCompletion[]> {
  const attributeFilter: QueryExpression | undefined =
    attributeCompleteEvent.source === ""
      ? undefined
      : ["=", ["attr", "tag"], ["string", attributeCompleteEvent.source]];
  const allAttributes = await queryObjects<AttributeObject>("attribute", {
    filter: attributeFilter,
  });
  return allAttributes.map((value) => {
    return {
      name: value.name,
      source: value.tag,
      attributeType: value.attributeType,
      builtin: value.page === builtinPseudoPage,
    } as AttributeCompletion;
  });
}

export async function attributeComplete(completeEvent: CompleteEvent) {
  if (/([\-\*]\s+\[)([^\]]+)$/.test(completeEvent.linePrefix)) {
    // Don't match task states, which look similar
    return null;
  }
  const inlineAttributeMatch = /([^\[\{}]|^)\[(\w+)$/.exec(
    completeEvent.linePrefix,
  );
  if (inlineAttributeMatch) {
    // console.log("Parents", completeEvent.parentNodes);
    let type = "page";
    if (completeEvent.parentNodes.includes("Task")) {
      type = "task";
    } else if (completeEvent.parentNodes.includes("ListItem")) {
      type = "item";
    }
    const completions = (await events.dispatchEvent(
      `attribute:complete:${type}`,
      {
        source: type,
        prefix: inlineAttributeMatch[2],
      } as AttributeCompleteEvent,
    )).flat() as AttributeCompletion[];
    return {
      from: completeEvent.pos - inlineAttributeMatch[2].length,
      options: attributeCompletionsToCMCompletion(
        completions.filter((completion) => !completion.builtin),
      ),
    };
  }
  const attributeMatch = /^(\w+)$/.exec(completeEvent.linePrefix);
  if (attributeMatch) {
    if (completeEvent.parentNodes.includes("FrontMatter")) {
      const pageMeta = await getObjectByRef(
        completeEvent.pageName,
        "page",
        completeEvent.pageName,
      );
      let tags = ["page"];
      if (pageMeta?.tags) {
        tags = pageMeta.tags;
      }
      const completions = (await Promise.all(tags.map((tag) =>
        events.dispatchEvent(
          `attribute:complete:${tag}`,
          {
            source: tag,
            prefix: attributeMatch[1],
          } as AttributeCompleteEvent,
        )
      ))).flat(2) as AttributeCompletion[];
      // console.log("Completions", completions);
      return {
        from: completeEvent.pos - attributeMatch[1].length,
        options: attributeCompletionsToCMCompletion(
          completions.filter((completion) =>
            !completion.builtin
          ),
        ),
      };
    }
  }
  return null;
}

export function attributeCompletionsToCMCompletion(
  completions: AttributeCompletion[],
) {
  return completions.map(
    (completion) => ({
      label: completion.name,
      apply: `${completion.name}: `,
      detail: `${completion.attributeType} (${completion.source})`,
      type: "attribute",
    }),
  );
}
