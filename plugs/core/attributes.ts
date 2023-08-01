import { index } from "$sb/silverbullet-syscall/mod.ts";
import type { CompleteEvent } from "$sb/app_event.ts";

export type AttributeContext = "page" | "item" | "task";

type AttributeEntry = {
  type: string;
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

export async function attributeComplete(completeEvent: CompleteEvent) {
  const inlineAttributeMatch = /([^\[]|^)\[(\w+)$/.exec(
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
    const allAttributes = await index.queryPrefix(
      `${attributeKeyPrefix}${type}:`,
    );
    return {
      from: completeEvent.pos - inlineAttributeMatch[2].length,
      options: allAttributes.map((attr) => {
        const [_prefix, _context, name] = attr.key.split(":");
        return {
          label: name,
          apply: `${name}: `,
          detail: attr.value.type,
          type: "attribute",
        };
      }),
    };
  }
  const attributeMatch = /^(\w+)$/.exec(completeEvent.linePrefix);
  if (attributeMatch) {
    if (completeEvent.parentNodes.includes("FrontMatterCode")) {
      const allAttributes = await index.queryPrefix(
        `${attributeKeyPrefix}page:`,
      );
      return {
        from: completeEvent.pos - attributeMatch[1].length,
        options: allAttributes.map((attr) => {
          const [_prefix, _context, name] = attr.key.split(":");
          return {
            label: name,
            apply: `${name}: `,
            detail: attr.value.type,
            type: "attribute",
          };
        }),
      };
    }
  }
  return null;
}
