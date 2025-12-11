export function extractSnippetAroundIndex(
  text: string,
  index: number,
  maxSnippetLength: number = 300,
): string {
  if (index < 0 || index >= text.length) {
    return "";
  }
  const lines = text.split("\n");
  let targetLineIndex = -1;

  // Find which line contains the index
  const textBeforeIndex = text.slice(0,index);
  const linesBeforeIndex = textBeforeIndex.matchAll(new RegExp("\n","g")).toArray();
  targetLineIndex = linesBeforeIndex.length;

  if (targetLineIndex === -1) {
    // Fallback to original sentence-based logic if line detection fails
    return extractSnippetAroundIndexLegacy(
      text,
      index,
      Math.min(maxSnippetLength, 100),
    );
  }

  // Get full text of target line


  let snippet = lines[targetLineIndex].trim();

  // If snippet is still too long, truncate while centering around the reference
  if (snippet.length > maxSnippetLength) {
    // Get the position of the index within the snippet based on the index of the newline character at the end of the preceding line
    const previousNewline = linesBeforeIndex.pop();
    const indexInSnippet = index - 1 - (previousNewline ? previousNewline.index : 0);

    // Center the truncation around the reference
    const halfLength = Math.floor(maxSnippetLength / 2);
    const ellipsisLength = 3;

    // Calculate ideal start and end positions centered on the reference
    let idealStart = Math.max(0, indexInSnippet - halfLength);
    let idealEnd = Math.min(snippet.length, indexInSnippet + halfLength);

    // Adjust if at beginning/end, use available space
    if (idealStart === 0) {
      idealEnd = Math.min(snippet.length, maxSnippetLength - ellipsisLength);
    } else if (idealEnd === snippet.length) {
      idealStart = Math.max(
        0,
        snippet.length - maxSnippetLength + ellipsisLength,
      );
    }

    // Find word boundaries for cleaner truncation
    let truncateStart = idealStart;
    let truncateEnd = idealEnd;

    // Adjust start to word boundary if not at the beginning
    if (truncateStart > 0) {
      const nearbySpace = snippet.lastIndexOf(" ", truncateStart + 20);
      if (nearbySpace !== -1 && nearbySpace >= truncateStart - 20) {
        truncateStart = nearbySpace + 1;
      }
    }

    // Adjust end to word boundary if not at the end
    if (truncateEnd < snippet.length) {
      const nearbySpace = snippet.indexOf(" ", truncateEnd - 20);
      if (nearbySpace !== -1 && nearbySpace <= truncateEnd + 20) {
        truncateEnd = nearbySpace;
      }
    }

    // Don't exceed maxSnippetLength with ellipsis
    const needsStartEllipsis = truncateStart > 0;
    const needsEndEllipsis = truncateEnd < snippet.length;
    const availableLength = maxSnippetLength -
      (needsStartEllipsis ? ellipsisLength : 0) -
      (needsEndEllipsis ? ellipsisLength : 0);

    if (truncateEnd - truncateStart > availableLength) {
      // If still too long, prioritize keeping the reference centered
      const excess = (truncateEnd - truncateStart) - availableLength;
      const reduceStart = Math.floor(excess / 2);
      const reduceEnd = excess - reduceStart;

      truncateStart += reduceStart;
      truncateEnd -= reduceEnd;
    }

    let truncated = snippet.substring(truncateStart, truncateEnd).trim();

    if (needsStartEllipsis) {
      truncated = "..." + truncated;
    }
    if (needsEndEllipsis) {
      truncated = truncated + "...";
    }

    snippet = truncated;
  }

  return snippet;
}

// Legacy function for fallback compatibility
function extractSnippetAroundIndexLegacy(
  text: string,
  index: number,
  maxSnippetLength: number = 100,
): string {
  // Use Intl.Segmenter to segment the text into sentences
  const sentenceSegmenter = new Intl.Segmenter("en", {
    granularity: "sentence",
  });
  let sentences = [...sentenceSegmenter.segment(text)].map((segment) =>
    segment.segment
  );
  // Manual fixes for markdown notation
  const tempSentences: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (sentences[i] === "[[!" && sentences[i + 1]) {
      tempSentences.push(sentences[i] + sentences[i + 1]);
      i++;
    } else {
      tempSentences.push(sentences[i]);
    }
  }
  sentences = tempSentences;

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
