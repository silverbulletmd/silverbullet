const yamlKvRegex = /^\s*(\w+):\s*(.*)/;
const yamlListItemRegex = /^\s*-\s+(.+)/;

/**
 * Cheap YAML parser to determine tags (ugly, regex based but fast)
 * @param yamlText
 * @returns
 */
export function determineTags(yamlText: string): string[] {
  const lines = yamlText.split("\n");
  let inTagsSection = false;
  const tags: string[] = [];
  for (const line of lines) {
    const yamlKv = yamlKvRegex.exec(line);
    if (yamlKv) {
      const [key, value] = yamlKv.slice(1);
      // Looking for a 'tags' key
      if (key === "tags") {
        inTagsSection = true;
        // 'template' there? Yay!
        if (value) {
          tags.push(...value.split(/,\s*/));
        }
      } else {
        inTagsSection = false;
      }
    }
    const yamlListem = yamlListItemRegex.exec(line);
    if (yamlListem && inTagsSection) {
      tags.push(yamlListem[1]);
    }
  }
  return tags;
}
