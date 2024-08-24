import type {
  CompleteEvent,
  ObjectValue,
  QueryExpression,
} from "../../plug-api/types.ts";
import { events, system } from "@silverbulletmd/silverbullet/syscalls";
import { queryObjects } from "./api.ts";
import { determineTags } from "$lib/cheap_yaml.ts";
import type { TagObject } from "./tags.ts";

export type SimpleJSONType = {
  type?: "string" | "number" | "boolean" | "any" | "array" | "object" | "null";
  items?: SimpleJSONType;
  properties?: Record<string, SimpleJSONType>;
  anyOf?: SimpleJSONType[];
};

export type AdhocAttributeObject = ObjectValue<{
  name: string;
  schema: SimpleJSONType;
  tagName: string;
  page: string;
}>;

export type AttributeCompleteEvent = {
  source: string;
  prefix: string;
};

export type AttributeCompletion = {
  name: string;
  source: string;
  // String version of JSON schema
  attributeType: string;
  readOnly?: boolean;
};

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
  const schema = await system.getSpaceConfig("schema");
  const allAttributes = (await queryObjects<AdhocAttributeObject>("ah-attr", {
    filter: attributeFilter,
    distinct: true,
    select: [{ name: "name" }, { name: "schema" }, { name: "tag" }, {
      name: "tagName",
    }],
  }, 5)).map((value) => {
    return {
      name: value.name,
      source: value.tagName,
      attributeType: jsonTypeToString(value.schema),
    } as AttributeCompletion;
  });
  // Add attributes from the direct schema
  addAttributeCompletionsForTag(
    schema,
    attributeCompleteEvent.source,
    allAttributes,
  );
  // Look up the tag so we can check the parent as well
  const sourceTags = await queryObjects<TagObject>("tag", {
    filter: ["=", ["attr", "name"], ["string", attributeCompleteEvent.source]],
  });
  if (sourceTags.length > 0) {
    addAttributeCompletionsForTag(schema, sourceTags[0].parent, allAttributes);
  }

  return allAttributes;
}

function addAttributeCompletionsForTag(
  schema: any,
  tag: string,
  allAttributes: AttributeCompletion[],
) {
  if (schema.tag[tag]) {
    for (
      const [name, value] of Object.entries(
        schema.tag[tag].properties as Record<
          string,
          any
        >,
      )
    ) {
      allAttributes.push({
        name,
        source: tag,
        attributeType: jsonTypeToString(value),
        readOnly: value.readOnly,
      });
    }
  }
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

/**
 * Attempt some reasonable stringification of a JSON schema
 * @param schema
 * @returns
 */
export function jsonTypeToString(schema: SimpleJSONType): string {
  if (schema.anyOf) {
    return schema.anyOf.map(jsonTypeToString).join(" | ");
  } else if (schema.type === "array") {
    if (schema.items) {
      return `${jsonTypeToString(schema.items)}[]`;
    } else {
      return "any[]";
    }
  } else if (schema.type === "object") {
    if (schema.properties) {
      return `{${
        Object.entries(schema.properties).map(([k, v]) =>
          `${k}: ${jsonTypeToString(v)};`
        ).join(" ")
      }}`;
    } else {
      return "{}";
    }
  }
  return schema.type!;
}

export function determineType(v: any): SimpleJSONType {
  const t = typeof v;
  if (t === "undefined" || v === null) {
    return { type: "null" };
  } else if (t === "object") {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        return {
          type: "array",
        };
      } else {
        return {
          type: "array",
          items: determineType(v[0]),
        };
      }
    } else {
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(v).map(([k, v]) => [k, determineType(v)]),
        ),
      };
    }
  } else if (t === "number") {
    return { type: "number" };
  } else if (t === "boolean") {
    return { type: "boolean" };
  } else if (t === "string") {
    return { type: "string" };
  } else {
    return { type: "any" };
  }
}
