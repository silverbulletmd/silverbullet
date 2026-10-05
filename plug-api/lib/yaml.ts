export type YamlPatch = {
  op: "set-key" | "delete-key";
  path: string; // Top-level key names only
  value?: any; // Required for set-key, not used for delete-key
};

function serializeToYamlScalar(
  value: string | number | boolean | null,
): string {
  if (typeof value === "string") {
    if (
      value === "" || // Empty string
      value.match(/[:{#}[],&*!|>'"%@`]/) || // Special YAML characters
      /^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) || // Looks like a number
      value.includes(":") || // Contains colons
      ["true", "false", "null", "yes", "no", "on", "off"].includes(
        value.toLowerCase(),
      )
    ) {
      return JSON.stringify(value);
    }
    return value;
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  return "null";
}

function serializeToYamlValue(
  value: any,
  baseIndentation: string = "",
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]"; // Use flow style for empty arrays for simplicity
    }
    const itemIndentation = `${baseIndentation}  `;
    return (
      "\n" +
      value
        .map(
          (item) =>
            `${itemIndentation}- ${serializeToYamlValue(item, itemIndentation)}`,
        )
        .join("\n")
    );
  } else if (typeof value === "object" && value !== null) {
    // Nested object serialization is limited.
    const itemIndentation = `${baseIndentation}  `;
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}"; // Flow style empty objects
    return (
      "\n" +
      entries
        .map(
          ([key, val]) =>
            `${itemIndentation}${key}: ${serializeToYamlValue(
              val,
              itemIndentation,
            )}`,
        )
        .join("\n")
    );
  } else {
    return serializeToYamlScalar(value);
  }
}

export function applyPatches(yamlString: string, patches: YamlPatch[]): string {
  let currentYaml = yamlString;

  for (const patch of patches) {
    if (patch.op === "delete-key") {
      const key = patch.path;
      const lines = currentYaml.split("\n");
      let keyLineIndex = -1;
      let startDeleteIndex = -1;
      let endDeleteIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith(`${key}:`)) {
          keyLineIndex = i;
          startDeleteIndex = i;
          endDeleteIndex = i;

          // Look backwards for preceding comments (delete them too)
          for (let j = i - 1; j >= 0; j--) {
            const prevLine = lines[j].trim();
            if (prevLine.startsWith("#")) {
              startDeleteIndex = j;
            } else if (prevLine !== "") {
              break;
            } else {
              // Empty line - include it in deletion if followed by comments
              if (startDeleteIndex < i) {
                startDeleteIndex = j;
              } else {
                break;
              }
            }
          }

          const keyIndent = lines[i].match(/^(\s*)/)?.[1] || "";

          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j];
            const trimmedNextLine = nextLine.trim();

            if (trimmedNextLine === "") {
              continue;
            }

            // Comment at same or greater indentation - might be trailing comment
            if (trimmedNextLine.startsWith("#")) {
              const commentIndent = nextLine.match(/^(\s*)/)?.[1] || "";
              if (commentIndent.length > keyIndent.length) {
                endDeleteIndex = j;
                continue;
              } else {
                // Comment at same or less indentation - not part of this key
                break;
              }
            }

            const nextIndent = nextLine.match(/^(\s*)/)?.[1] || "";
            if (nextIndent.length > keyIndent.length) {
              endDeleteIndex = j;
            } else {
              break;
            }
          }

          break;
        }
      }

      if (keyLineIndex !== -1) {
        const beforeDelete = lines.slice(0, startDeleteIndex);
        const afterDelete = lines.slice(endDeleteIndex + 1);

        while (
          beforeDelete.length > 0 &&
          beforeDelete[beforeDelete.length - 1].trim() === ""
        ) {
          beforeDelete.pop();
        }

        // Remove leading empty lines from afterDelete (but keep one if there's content after)
        let leadingEmptyCount = 0;
        for (const line of afterDelete) {
          if (line.trim() === "") {
            leadingEmptyCount++;
          } else {
            break;
          }
        }
        const cleanedAfterDelete = afterDelete.slice(
          Math.min(leadingEmptyCount, 1),
        );

        currentYaml = [...beforeDelete, ...cleanedAfterDelete].join("\n");
        if (currentYaml && !currentYaml.endsWith("\n")) {
          currentYaml += "\n";
        }
      }
      continue;
    }

    if (patch.op !== "set-key") continue;

    const key = patch.path;

    const lines = currentYaml.split("\n");
    let keyLineIndex = -1;
    let commentBlock = "";
    let trailingComments = "";
    let inlineComment = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith(`${key}:`)) {
        keyLineIndex = i;
        const commentMatch = line.match(/#.*$/);
        if (commentMatch) {
          inlineComment = commentMatch[0];
        }
        for (let j = i - 1; j >= 0; j--) {
          const prevLine = lines[j].trim();
          if (prevLine.startsWith("#")) {
            commentBlock = `${lines[j]}\n${commentBlock}`;
          } else if (prevLine !== "") {
            break;
          }
        }
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith("#")) {
            trailingComments += `${lines[j]}\n`;
          } else if (nextLine !== "") {
            break;
          }
        }
        break;
      }
    }

    const serializedNewValue = serializeToYamlValue(patch.value);

    let replacementLine: string;
    if (serializedNewValue.startsWith("\n")) {
      replacementLine = `${key}:${inlineComment}${serializedNewValue}`;
    } else {
      replacementLine = `${key}: ${serializedNewValue}${
        inlineComment ? ` ${inlineComment}` : ""
      }`;
    }

    if (keyLineIndex !== -1) {
      // Replace the existing line while preserving comments
      const beforeKey = lines.slice(
        0,
        keyLineIndex - commentBlock.split("\n").filter(Boolean).length,
      );
      const afterKey = lines.slice(
        keyLineIndex + 1 + trailingComments.split("\n").filter(Boolean).length,
      );

      const newContent = [
        ...beforeKey,
        ...commentBlock.split("\n").filter(Boolean),
        replacementLine,
        ...trailingComments.split("\n").filter(Boolean),
        ...afterKey,
      ];

      currentYaml = `${newContent.join("\n").replace(/\n*$/, "\n")}\n`;
    } else {
      const newLineBlock = replacementLine;
      if (currentYaml.trim() === "") {
        currentYaml = `${newLineBlock}\n`;
      } else {
        currentYaml = `${currentYaml.replace(/\n*$/, "\n") + newLineBlock}\n`;
      }
    }
  }

  return currentYaml.replace(/\n*$/, "\n");
}
