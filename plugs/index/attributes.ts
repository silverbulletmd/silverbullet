import type { CompleteEvent } from "../../plug-api/types.ts";
import { events } from "$sb/syscalls.ts";
import { queryObjects } from "./api.ts";
import { ObjectValue, QueryExpression } from "../../plug-api/types.ts";
import { determineTags } from "$lib/cheap_yaml.ts";

export type AttributeObject = ObjectValue<{
  name: string;
  attributeType: string;
  tagName: string;
  page: string;
  readOnly: boolean;
}>;

export type AttributeCompleteEvent = {
  source: string;
  prefix: string;
};

export type AttributeCompletion = {
  name: string;
  source: string;
  attributeType: string;
  readOnly: boolean;
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

/**
 * Triggered by the `attribute:complete:*` event (that is: gimme all attribute completions)
 * @param attributeCompleteEvent
 * @returns
 */
export async function objectAttributeCompleter(
  attributeCompleteEvent: AttributeCompleteEvent,
): Promise<AttributeCompletion[]> {
  const attributeFilter: QueryExpression | undefined =
    attributeCompleteEvent.source === ""
      ? undefined
      : ["=", ["attr", "tagName"], ["string", attributeCompleteEvent.source]];
  const allAttributes = await queryObjects<AttributeObject>("attribute", {
    filter: attributeFilter,
    distinct: true,
    select: [{ name: "name" }, { name: "attributeType" }, { name: "tag" }, {
      name: "readOnly",
    }, { name: "tagName" }],
  }, 5);
  return allAttributes.map((value) => {
    return {
      name: value.name,
      source: value.tagName,
      attributeType: value.attributeType,
      readOnly: value.readOnly,
    } as AttributeCompletion;
  });
}

/**
 * Offer completions for _setting_ attributes on objects (either in frontmatter or inline)
 * Triggered by `editor:complete` events from the editor
 */
export async function attributeComplete(completeEvent: CompleteEvent) {
  if (/([\-\*]\s+\[)([^\]]+)$/.test(completeEvent.linePrefix)) {
    // Don't match task states, which look similar
    return null;
  }

  // Inline attribute completion (e.g. [myAttr: 10])
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
        // Filter out read-only attributes
        completions.filter((completion) => !completion.readOnly),
      ),
    };
  }

  // Frontmatter attribute completion
  const attributeMatch = /^(\w+)$/.exec(completeEvent.linePrefix);
  if (attributeMatch) {
    const frontmatterParent = completeEvent.parentNodes.find((node) =>
      node.startsWith("FrontMatter:")
    );
    if (frontmatterParent) {
      const tags = [
        "page",
        ...determineTags(frontmatterParent.slice("FrontMatter:".length)),
      ];

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
            !completion.readOnly
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
