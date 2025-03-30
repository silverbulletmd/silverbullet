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

export function applyMinimalSetKeyPatches(
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

    // Regex to find the key at the beginning of a line, optionally indented,
    // capturing the value and any trailing comment separately
    const regex = new RegExp(
      `^(\\s*)(${key}):\\s*([^#\\n]*?)\\s*(#.*)?\\s*$`,
      "m",
    );
    const match = currentYaml.match(regex);

    if (match) {
      // Key found: Replace the existing line/block
      const [fullMatch, indentation, _keyMatch, _oldValue, inlineComment = ""] =
        match;
      const originalLine = fullMatch;

      // Serialize the new value. Pass the key's indentation for list/object formatting.
      const serializedNewValue = serializeToYamlValue(patch.value, indentation);

      let replacementString: string;
      // Check if the new value requires multi-line formatting (list/object starting with newline)
      if (serializedNewValue.startsWith("\n")) {
        // For lists/objects, the key line ends with just ':' plus any comment
        replacementString =
          `${indentation}${key}:${inlineComment}${serializedNewValue}`;
      } else {
        // For scalars, format as key: value plus any comment
        // Ensure proper spacing around the inline comment
        replacementString = `${indentation}${key}: ${serializedNewValue}${
          inlineComment ? " " + inlineComment : ""
        }`;
      }

      // Find any standalone comments before this key and preserve them
      const lines = currentYaml.split("\n");
      const keyLineIndex = lines.findIndex((line) =>
        line.trim() === originalLine.trim()
      );
      let commentBlock = "";

      // Look backwards from the key line to collect any standalone comments
      for (let i = keyLineIndex - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("#")) {
          commentBlock = lines[i] + "\n" + commentBlock;
        } else if (line !== "") {
          break;
        }
      }

      // Replace the original line while preserving comments
      if (commentBlock) {
        currentYaml = currentYaml.replace(
          commentBlock + originalLine,
          commentBlock + replacementString,
        );
      } else {
        currentYaml = currentYaml.replace(originalLine, replacementString);
      }
    } else {
      // Key not found: Add the new key-value pair to the end
      const indentation = ""; // No indentation for new top-level keys
      const serializedNewValue = serializeToYamlValue(patch.value, indentation);

      let newLineBlock: string;
      // Check if the new value requires multi-line formatting
      if (serializedNewValue.startsWith("\n")) {
        newLineBlock = `${key}:${serializedNewValue}`; // Key, colon, then newline and indented items/properties
      } else {
        newLineBlock = `${key}: ${serializedNewValue}`; // Key, colon, space, scalar value
      }

      // Append the new line/block, ensuring proper spacing
      if (currentYaml.trim() === "") {
        currentYaml = newLineBlock; // If yaml was empty, just set it
      } else {
        // Add a newline before appending if needed
        currentYaml = currentYaml.replace(/\n*$/, "\n"); // Ensure single trailing newline
        currentYaml += newLineBlock + "\n"; // Append and add trailing newline
      }
    }
  }

  return currentYaml;
}
