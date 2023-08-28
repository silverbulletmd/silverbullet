import { index } from "$sb/silverbullet-syscall/mod.ts";
import type { CompleteEvent } from "$sb/app_event.ts";
import { events } from "$sb/syscalls.ts";

export type AttributeContext = "page" | "item" | "task";

type AttributeEntry = {
  type: string;
};

export type AttributeCompleteEvent = {
  source: string;
  prefix: string;
};

export type AttributeCompletion = {
  name: string;
  source: string;
  type: string;
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
    freq: "number",
  },
};

function determineType(v: any): string {
  const t = typeof v;
  if (t === "object") {
    if (Array.isArray(v)) {
      return "array";
    }
  }
  return t;
}

const attributeKeyPrefix = "attr:";

export async function indexAttributes(
  pageName: string,
  attributes: Record<string, any>,
  context: AttributeContext,
) {
  await index.batchSet(
    pageName,
    Object.entries(attributes).map(([k, v]) => {
      return {
        key: `${attributeKeyPrefix}${context}:${k}`,
        value: {
          type: determineType(v),
        } as AttributeEntry,
      };
    }),
  );
}

export async function customAttributeCompleter(
  attributeCompleteEvent: AttributeCompleteEvent,
): Promise<AttributeCompletion[]> {
  const sourcePrefix = attributeCompleteEvent.source === "*"
    ? ""
    : `${attributeCompleteEvent.source}:`;
  const allAttributes = await index.queryPrefix(
    `${attributeKeyPrefix}${sourcePrefix}`,
  );
  return allAttributes.map((attr) => {
    const [_prefix, context, name] = attr.key.split(":");
    return {
      name,
      source: context,
      type: attr.value.type,
    };
  });
}

export function builtinAttributeCompleter(
  attributeCompleteEvent: AttributeCompleteEvent,
): AttributeCompletion[] {
  let allAttributes = builtinAttributes[attributeCompleteEvent.source];
  if (attributeCompleteEvent.source === "*") {
    allAttributes = {};
    for (const [source, attributes] of Object.entries(builtinAttributes)) {
      for (const [name, type] of Object.entries(attributes)) {
        allAttributes[name] = `${type}|${source}`;
      }
    }
  }
  if (!allAttributes) {
    return [];
  }
  return Object.entries(allAttributes).map(([name, type]) => {
    return {
      name,
      source: attributeCompleteEvent.source === "*"
        ? type.split("|")[1]
        : attributeCompleteEvent.source,
      type: attributeCompleteEvent.source === "*" ? type.split("|")[0] : type,
      builtin: true,
    };
  });
}

export async function attributeComplete(completeEvent: CompleteEvent) {
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
      detail: `${completion.type} (${completion.source})`,
      type: "attribute",
    }),
  );
}
