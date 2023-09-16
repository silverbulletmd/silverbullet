import type { CompleteEvent } from "$sb/app_event.ts";
import { events } from "$sb/syscalls.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { QueryExpression } from "$sb/types.ts";

const builtinPseudoPage = ":builtin:";

export type AttributeObject = {
  name: string;
  attributeType: string;
  type: string;
  page: string;
};

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

const builtinAttributes: Record<string, Record<string, string>> = {
  page: {
    name: "string",
    lastModified: "number",
    perm: "rw|ro",
    contentType: "string",
    size: "number",
    tags: "array",
  },
  task: {
    name: "string",
    done: "boolean",
    page: "string",
    state: "string",
    deadline: "string",
    pos: "number",
    tags: "array",
  },
  item: {
    name: "string",
    page: "string",
    pos: "number",
    tags: "array",
  },
  tag: {
    name: "string",
    page: "string",
    context: "string",
  },
  attribute: {
    name: "string",
    attributeType: "string",
    type: "string",
    page: "string",
  },
  anchor: {
    name: "string",
    page: "string",
    pos: "number",
  },
  link: {
    name: "string",
    page: "string",
    pos: "number",
    alias: "string",
    inDirective: "boolean",
    asTemplate: "boolean",
  },
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

export async function indexAttributes(
  page: string,
  attributes: AttributeObject[],
) {
  const setAttributes = new Set<string>();
  const filteredAttributes = attributes.filter((attr) => {
    const key = `${attr.type}:${attr.name}`;
    // Remove duplicates, that's ok
    if (setAttributes.has(key)) {
      return false;
    }
    setAttributes.add(key);
    return attr.page === builtinPseudoPage ||
      !builtinAttributes[attr.type]?.[attr.name];
  });
  if (Object.keys(filteredAttributes).length > 0) {
    await indexObjects(
      page,
      filteredAttributes.map((attr) => {
        return {
          key: [attr.type, attr.name],
          type: "attribute",
          value: attr,
        };
      }),
    );
  }
}

export async function objectAttributeCompleter(
  attributeCompleteEvent: AttributeCompleteEvent,
): Promise<AttributeCompletion[]> {
  const attributeFilter: QueryExpression | undefined =
    attributeCompleteEvent.source === ""
      ? undefined
      : ["=", ["attr", "type"], ["string", attributeCompleteEvent.source]];
  const allAttributes = await queryObjects<AttributeObject>("attribute", {
    filter: attributeFilter,
  });
  return allAttributes.map(({ value }) => {
    return {
      name: value.name,
      source: value.type,
      attributeType: value.attributeType,
      builtin: value.page === builtinPseudoPage,
    } as AttributeCompletion;
  });
}

export async function loadBuiltinsIntoIndex() {
  console.log("Loading builtins into index");
  const allAttributes: AttributeObject[] = [];
  for (const [source, attributes] of Object.entries(builtinAttributes)) {
    for (const [name, attributeType] of Object.entries(attributes)) {
      allAttributes.push({
        name,
        attributeType,
        type: source,
        page: builtinPseudoPage,
      });
    }
  }
  await indexAttributes(builtinPseudoPage, allAttributes);
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
    if (completeEvent.parentNodes.includes("FrontMatterCode")) {
      const completions = (await events.dispatchEvent(
        `attribute:complete:page`,
        {
          source: "page",
          prefix: attributeMatch[1],
        } as AttributeCompleteEvent,
      )).flat() as AttributeCompletion[];
      return {
        from: completeEvent.pos - attributeMatch[1].length,
        options: attributeCompletionsToCMCompletion(
          completions.filter((completion) => !completion.builtin),
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
