import { events } from "$sb/plugos-syscall/mod.ts";
import { CompleteEvent } from "$sb/app_event.ts";
import { buildHandebarOptions } from "./util.ts";
import type { PageMeta } from "../../web/types.ts";
import { index } from "$sb/silverbullet-syscall/mod.ts";

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

export async function queryComplete(completeEvent: CompleteEvent) {
  const querySourceMatch = /#query\s+([\w\-_]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (querySourceMatch) {
    const allEvents = await events.listEvents();

    return {
      from: completeEvent.pos - querySourceMatch[1].length,
      options: allEvents
        .filter((eventName) => eventName.startsWith("query:"))
        .map((source) => ({
          label: source.substring("query:".length),
        })),
    };
  }

  if (completeEvent.parentNodes.includes("DirectiveStart")) {
    const querySourceMatch = /#query\s+([\w\-_]+)/.exec(
      completeEvent.linePrefix,
    );
    const whereMatch =
      /(where|order\s+by|and|select(\s+[\w\s,]+)?)\s+([\w\-_]*)$/.exec(
        completeEvent.linePrefix,
      );
    if (querySourceMatch && whereMatch) {
      const type = querySourceMatch[1];
      const attributePrefix = whereMatch[3];
      // console.log("Type", type);
      // console.log("Where", attributePrefix);
      const allAttributes = await index.queryPrefix(
        `attr:${type}:`,
      );
      const customAttributesCompletions = allAttributes.map((attr) => {
        const [_prefix, _context, name] = attr.key.split(":");
        return {
          label: name,
          detail: attr.value.type,
          type: "attribute",
        };
      });
      const builtinAttributesCompletions = builtinAttributes[type]
        ? Object.entries(
          builtinAttributes[type],
        ).map(([name, type]) => ({
          label: name,
          detail: type,
          type: "attribute",
        }))
        : [];
      return {
        from: completeEvent.pos - attributePrefix.length,
        options: [
          ...customAttributesCompletions,
          ...builtinAttributesCompletions,
        ],
      };
    }
  }
  return null;
}

export function handlebarHelperComplete(completeEvent: CompleteEvent) {
  const match = /\{\{([\w@]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  const handlebarOptions = buildHandebarOptions({ name: "" } as PageMeta);
  const allCompletions = Object.keys(handlebarOptions.helpers).concat(
    Object.keys(handlebarOptions.data).map((key) => `@${key}`),
  );

  return {
    from: completeEvent.pos - match[1].length,
    options: allCompletions
      .map((name) => ({
        label: name,
      })),
  };
}
