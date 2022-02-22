export function countWords(str: string): number {
  var matches = str.match(/[\w\d\'\'-]+/gi);
  return matches ? matches.length : 0;
}

export function readingTime(wordCount: number): number {
  // 225 is average word reading speed for adults
  return Math.ceil(wordCount / 225);
}
