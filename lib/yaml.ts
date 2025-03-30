// Define the patch structure
export interface SetKeyPatch {
  op: "set-key";
  path: string; // Still assuming simple, top-level key names
  value: any; // Allow any value, including arrays
}

// Helper function specifically for serializing scalar types
function serializeToYamlScalar(
  value: string | number | boolean | null,
): string {
  if (typeof value === "string") {
    // Always quote empty strings and strings with special characters
    if (
      value === "" || // Empty string
      value.match(/[:{#}[],&*!|>'"%@`]/) || // Special YAML characters (added % and ")
      /^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) || // Looks like a number
      value.includes(":") || // Contains colons
      ["true", "false", "null", "yes", "no", "on", "off"].includes(
        value.toLowerCase(),
      )
    ) {
      return JSON.stringify(value);
    }
    // Simple strings without special chars/meaning don't need quotes
    return value;
  } else if (
    typeof value === "number" || typeof value === "boolean" || value === null
  ) {
    return String(value);
  }
  // Default for unsupported scalar types (e.g., undefined)
  return "null";
}

// Updated helper function to serialize various JS types to YAML string representations
// Added baseIndentation parameter for handling nested lists correctly (though we only use it for top-level lists here)
function serializeToYamlValue(
  value: any,
  baseIndentation: string = "",
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]"; // Use flow style for empty arrays for simplicity
    }
    // Determine indentation for list items (base + 2 spaces)
    const itemIndentation = baseIndentation + "  ";
    // Format each item recursively, preceded by '- ' marker
    return "\n" +
      value.map((item) =>
        `${itemIndentation}- ${serializeToYamlValue(item, itemIndentation)}`
      ).join("\n");
    // Note: serializeToYamlValue is used recursively here to handle nested arrays/objects if needed in future
    // However, the current `applyMinimalSetKeyPatches` only handles top-level keys.
  } else if (typeof value === "object" && value !== null) {
    // Basic object serialization (not requested, but good to consider)
    // This is highly simplified and doesn't handle nesting well without more context
    const itemIndentation = baseIndentation + "  ";
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}"; // Flow style empty objects
    return "\n" +
      entries.map(([key, val]) =>
        `${itemIndentation}${key}: ${
          serializeToYamlValue(val, itemIndentation)
        }`
      ).join("\n");
  } else {
    // Handle scalars using the dedicated function
    return serializeToYamlScalar(value);
  }
}

export function applyPatches(
  yamlString: string,
  patches: SetKeyPatch[],
): string {
  let currentYaml = yamlString;

  for (const patch of patches) {
    if (patch.op !== "set-key") continue;

    // Still simplifying: Only handle top-level keys
    if (patch.path.includes(".") || patch.path.includes("[")) {
      console.warn(
        `Skipping patch for nested or invalid key path (not supported): ${patch.path}`,
      );
      continue;
    }

    const key = patch.path;

    // Split the YAML into lines for easier processing
    const lines = currentYaml.split("\n");
    let keyLineIndex = -1;
    let commentBlock = "";
    let trailingComments = "";
    let inlineComment = "";

    // Find the key line and collect comments
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith(key + ":")) {
        keyLineIndex = i;
        // Extract inline comment if present
        const commentMatch = line.match(/#.*$/);
        if (commentMatch) {
          inlineComment = commentMatch[0];
        }
        // Look backwards for comments
        for (let j = i - 1; j >= 0; j--) {
          const prevLine = lines[j].trim();
          if (prevLine.startsWith("#")) {
            commentBlock = lines[j] + "\n" + commentBlock;
          } else if (prevLine !== "") {
            break;
          }
        }
        // Look forwards for comments
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith("#")) {
            trailingComments += lines[j] + "\n";
          } else if (nextLine !== "") {
            break;
          }
        }
        break;
      }
    }

    // Serialize the new value
    const serializedNewValue = serializeToYamlValue(patch.value);

    // Create the replacement line
    let replacementLine: string;
    if (serializedNewValue.startsWith("\n")) {
      // For lists/objects, the key line ends with just ':'
      replacementLine = `${key}:${inlineComment}${serializedNewValue}`;
    } else {
      // For scalars, format as key: value
      replacementLine = `${key}: ${serializedNewValue}${
        inlineComment ? " " + inlineComment : ""
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

      // Build the new content
      const newContent = [
        ...beforeKey,
        ...commentBlock.split("\n").filter(Boolean),
        replacementLine,
        ...trailingComments.split("\n").filter(Boolean),
        ...afterKey,
      ];

      // Join lines and ensure proper newlines
      currentYaml = newContent.join("\n").replace(/\n*$/, "\n") + "\n";
    } else {
      // Key not found: Add the new key-value pair to the end
      const newLineBlock = replacementLine;
      if (currentYaml.trim() === "") {
        currentYaml = newLineBlock + "\n";
      } else {
        currentYaml = currentYaml.replace(/\n*$/, "\n") + newLineBlock + "\n";
      }
    }
  }

  // Ensure the result ends with a newline
  return currentYaml.replace(/\n*$/, "\n");
}
