function countWords(str: string): number {
  const matches = str.match(/[\w\d\'-]+/gi);
  return matches ? matches.length : 0;
}

function readingTime(wordCount: number): number {
  // 225 is average word reading speed for adults
  return Math.ceil(wordCount / 225);
}
