import { determineTags } from "$sb/lib/cheap_yaml.ts";

const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;

/**
 * Quick and dirty way to check if a page is a template or not
 * @param pageText
 * @returns
 */
export function isTemplate(pageText: string): boolean {
  const frontmatter = frontMatterRegex.exec(pageText);
  // Poor man's YAML frontmatter parsing
  if (frontmatter) {
    pageText = pageText.slice(frontmatter[0].length);
    const frontmatterText = frontmatter[1];
    const tags = determineTags(frontmatterText);
    if (tags.includes("template")) {
      return true;
    }
  }
  // Or if the page text starts with a #template tag
  if (/^\s*#template(\W|$)/.test(pageText)) {
    return true;
  }
  return false;
}
