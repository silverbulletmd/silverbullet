export function extractSnippetAroundIndex(
  text: string,
  index: number,
  maxSnippetLength: number = 300,
  maxLines: number = 3,
): string {
  if (index < 0 || index >= text.length) {
    return "";
  }
  const lines = text.split("\n");
  let currentPos = 0;
  let targetLineIndex = -1;

  // Find which line contains the index
  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + (i < lines.length - 1 ? 1 : 0); // +1 for newline except last line
    if (index >= currentPos && index < currentPos + lineLength) {
      targetLineIndex = i;
      break;
    }
    currentPos += lineLength;
  }

  if (targetLineIndex === -1) {
    // Fallback to original sentence-based logic if line detection fails
    return extractSnippetAroundIndexLegacy(
      text,
      index,
      Math.min(maxSnippetLength, 100),
    );
  }

  // Calculate range of lines to include (up to maxLines, centered around target)
  const linesToInclude = Math.min(maxLines, lines.length);
  const linesAbove = Math.floor((linesToInclude - 1) / 2);
  const linesBelow = linesToInclude - 1 - linesAbove;

  const startLine = Math.max(0, targetLineIndex - linesAbove);
  const endLine = Math.min(lines.length - 1, targetLineIndex + linesBelow);

  const selectedLines = lines.slice(startLine, endLine + 1);

  // Stop at markdown list boundaries to avoid including separate bullet points
  const processedLines: string[] = [];
  let foundTargetLine = false;

  for (let i = 0; i < selectedLines.length; i++) {
    const line = selectedLines[i];
    const isCurrentTargetLine = (startLine + i) === targetLineIndex;

    if (isCurrentTargetLine) {
      foundTargetLine = true;
      processedLines.push(line);
    } else if (!foundTargetLine) {
      // Before target line - include it
      processedLines.push(line);
    } else {
      // After target line - check if it's a new bullet point or list item
      const trimmedLine = line.trim();
      if (trimmedLine.match(/^[*+-]\s/) || trimmedLine.match(/^\d+\.\s/)) {
        // New bullt point or numbered list item
        break;
      }
      processedLines.push(line);
    }
  }

  let snippet = processedLines.join(" ").replace(/\s+/g, " ").trim();

  // If snippet is still too long, truncate while centering around the reference
  if (snippet.length > maxSnippetLength) {
    // Calculate the position of the index within the multi-line snippet
    let snippetStartPos = 0;
    for (let i = 0; i < startLine; i++) {
      snippetStartPos += lines[i].length + (i < lines.length - 1 ? 1 : 0); // +1 for newline except last line
    }
    const indexInSnippet = index - snippetStartPos;

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
