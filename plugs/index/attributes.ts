import type { CompleteEvent } from "$sb/app_event.ts";
import { events } from "$sb/syscalls.ts";
import { indexObjects, queryObjects } from "./plug_api.ts";
import { QueryExpression } from "$sb/types.ts";

const builtinPseudoPage = ":builtin:";

type AttributeEntry = {
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
    freq: "number",
  },
  attribute: {
    name: "string",
    attributeType: "string",
    type: "string",
    page: "string",
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

export async function indexAttributes(
  page: string,
  type: string,
  attributes: Record<string, any>,
) {
  const filteredAttributes = { ...attributes };
  if (page !== builtinPseudoPage) {
    for (const attr of Object.keys(filteredAttributes)) {
      if (builtinAttributes[type]?.[attr]) {
        delete filteredAttributes[attr];
      }
    }
  }
  if (Object.keys(filteredAttributes).length > 0) {
    await indexObjects(
      page,
      Object.entries(filteredAttributes).map(([k, v]) => {
        return {
          key: [type, k],
          type: "attribute",
          value: {
            name: k,
            attributeType: determineType(v),
            type,
            page: page,
          } as AttributeEntry,
        };
      }),
    );
  }
}

const builtinsLoaded = lazyPromise(loadBuiltinsIntoIndex);

export async function objectAttributeCompleter(
  attributeCompleteEvent: AttributeCompleteEvent,
): Promise<AttributeCompletion[]> {
  await builtinsLoaded();
  const attributeFilter: QueryExpression | undefined =
    attributeCompleteEvent.source === ""
      ? undefined
      : ["=", ["attr", "type"], ["string", attributeCompleteEvent.source]];
  const allAttributes = await queryObjects("attribute", {
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

async function loadBuiltinsIntoIndex() {
  for (const [source, attributes] of Object.entries(builtinAttributes)) {
    await indexAttributes(builtinPseudoPage, source, attributes);
  }
}

function lazyPromise<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => {
    if (!promise) {
      promise = fn();
    }
    return promise;
  };
}

export async function attributeComplete(completeEvent: CompleteEvent) {
  await builtinsLoaded();
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
