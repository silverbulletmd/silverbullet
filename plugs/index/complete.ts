import { config } from "@silverbulletmd/silverbullet/syscalls";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";
import type { Completion } from "@codemirror/autocomplete";

export async function attributeCompletion(
  tags: string[],
): Promise<Completion[]> {
  const completions: Completion[] = [];

  for (const tag of tags) {
    const schema = await config.get<any>(["tags", tag, "schema"], null);
    if (!schema) {
      continue;
    }
    for (const [attr, val] of Object.entries(schema.properties)) {
      const def = val as any;

      if (def.readOnly) {
        continue;
      }

      completions.push({
        label: attr,
        type: `attribute`,
        detail: `for #${tag} (type: ${humanReadableSchemaType(def)})${
          def.description ? ": " + def.description : ""
        }`,
        apply: `${attr}: `,
      });
    }
  }

  return completions;
}

function humanReadableSchemaType(type: any): string {
  if (!type) {
    return "any";
  }
  if (type.type) {
    return type.type;
  }
  if (type.anyOf) {
    return type.anyOf.map(humanReadableSchemaType).join(" | ");
  }
  return "any";
}

/**
 * Task state completion
 */
export async function completeTaskState(completeEvent: CompleteEvent) {
  const taskMatch = /([\-\*]\s+\[)([^\[\]]+)$/.exec(
    completeEvent.linePrefix,
  );
  if (!taskMatch) {
    return null;
  }
  const allStates = Object.keys(await config.get("taskStates", {}));

  return {
    from: completeEvent.pos - taskMatch[2].length,
    options: allStates.map((state) => ({
      label: state,
    })),
  };
}
