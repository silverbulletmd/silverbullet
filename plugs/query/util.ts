export const queryRegex =
  /(<!--\s*#query\s+(.+?)-->)(.+?)(<!--\s*#end\s*-->)/gs;

export function whiteOutQueries(text: string): string {
  return text.replaceAll(queryRegex, (match) =>
    new Array(match.length + 1).join(" ")
  );
}
