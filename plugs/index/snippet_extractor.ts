export function extractSnippetAroundIndex(
  text: string,
  index: number,
  maxSnippetLength: number = 100,
): string {
  // Use Intl.Segmenter to segment the text into sentences
  const sentenceSegmenter = new Intl.Segmenter("en", {
    granularity: "sentence",
  });
  const sentences = [...sentenceSegmenter.segment(text)].map((segment) =>
    segment.segment
  );

  // Find the sentence that contains the index
  let currentLength = 0;
  let targetSentence = "";
  for (const sentence of sentences) {
    if (index >= currentLength && index < currentLength + sentence.length) {
      targetSentence = sentence;
      break;
    }
    currentLength += sentence.length;
  }

  // If the target sentence is within the maxSnippetLength, return it
  if (targetSentence.length <= maxSnippetLength) {
    return targetSentence.trim();
  }

  const indexInSentence = index - currentLength;

  // Regex for checking if a character is a word character with unicode support
  const isWordCharacter = /[\p{L}\p{N}_]/u;

  // Find a reasonable word boundary to start the snippet
  let snippetStartIndex = Math.max(indexInSentence - maxSnippetLength / 2, 0);
  while (
    snippetStartIndex > 0 &&
    isWordCharacter.test(targetSentence[snippetStartIndex])
  ) {
    snippetStartIndex--;
  }
  snippetStartIndex = Math.max(snippetStartIndex, 0);

  // Find a reasonable word boundary to end the snippet
  let snippetEndIndex = Math.min(
    indexInSentence + maxSnippetLength / 2,
    targetSentence.length,
  );
  while (
    snippetEndIndex < targetSentence.length &&
    isWordCharacter.test(targetSentence[snippetEndIndex])
  ) {
    snippetEndIndex++;
  }
  snippetEndIndex = Math.min(snippetEndIndex, targetSentence.length);

  // Extract and return the refined snippet
  return "..." +
    targetSentence.substring(snippetStartIndex, snippetEndIndex).trim() + "...";
}
