import { FrontMatter } from "./frontmatter.ts";
import { ObjectValue } from "../types.ts";

export function updateITags<T>(obj: ObjectValue<T>, frontmatter: FrontMatter) {
  const itags = [obj.tag, ...frontmatter.tags || []];
  if (obj.tags) {
    for (const tag of obj.tags) {
      if (!itags.includes(tag)) {
        itags.push(tag);
      }
    }
  }
  obj.itags = itags;
}
