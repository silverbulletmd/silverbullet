export interface SnippetResult {
  snippet: string;
  fullSnippet?: string;
  hasMore: boolean;
}

export function extractSnippetAroundIndex(
  text: string,
  index: number,
  maxSnippetLength?: number,
  maxLines?: number,
): string;
export function extractSnippetAroundIndex(
  text: string,
  index: number,
  maxSnippetLength: number,
  maxLines: number,
  expandable: true,
): SnippetResult;
export function extractSnippetAroundIndex(
  text: string,
  index: number,
  maxSnippetLength: number = 300,
  maxLines: number = 3,
  expandable?: boolean,
): string | SnippetResult {
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
        // New bullet point or numbered list item
        break;
      }
      processedLines.push(line);
    }
  }

  let snippet = processedLines.join(" ").replace(/\s+/g, " ").trim();

  // For expandable snippets, also generate a longer version
  let fullSnippet: string | undefined;
  let hasMore = false;

  if (expandable) {
    // Generate full snippet with more lines (up to 10 lines or 800 chars)
    const fullMaxLines = Math.min(10, lines.length);
    const fullLinesAbove = Math.floor((fullMaxLines - 1) / 2);
    const fullLinesBelow = fullMaxLines - 1 - fullLinesAbove;

    const fullStartLine = Math.max(0, targetLineIndex - fullLinesAbove);
    const fullEndLine = Math.min(lines.length - 1, targetLineIndex + fullLinesBelow);

    const fullSelectedLines = lines.slice(fullStartLine, fullEndLine + 1);

    // For full snippet, be more permissive - allow some context from next sections
    const fullProcessedLines: string[] = [];
    let foundFullTargetLine = false;
    let bulletPointsAfterTarget = 0;

    for (let i = 0; i < fullSelectedLines.length; i++) {
      const line = fullSelectedLines[i];
      const isCurrentTargetLine = (fullStartLine + i) === targetLineIndex;

      if (isCurrentTargetLine) {
        foundFullTargetLine = true;
        fullProcessedLines.push(line);
      } else if (!foundFullTargetLine) {
        fullProcessedLines.push(line);
      } else {
        const trimmedLine = line.trim();
        if (trimmedLine.match(/^[*+-]\s/) || trimmedLine.match(/^\d+\.\s/)) {
          bulletPointsAfterTarget++;
          // For full snippet, allow one additional bullet point for context
          if (bulletPointsAfterTarget > 1) {
            break;
          }
        }
        fullProcessedLines.push(line);
      }
    }

    fullSnippet = fullProcessedLines.join(" ").replace(/\s+/g, " ").trim();

    // Truncate full snippet if too long but allow more space
    if (fullSnippet.length > 800) {
      const fullHalfLength = Math.floor(800 / 2);
      let fullSnippetStartPos = 0;
      for (let i = 0; i < fullStartLine; i++) {
        fullSnippetStartPos += lines[i].length + (i < lines.length - 1 ? 1 : 0);
      }
      const fullIndexInSnippet = index - fullSnippetStartPos;

      const fullIdealStart = Math.max(0, fullIndexInSnippet - fullHalfLength);
      const fullIdealEnd = Math.min(fullSnippet.length, fullIndexInSnippet + fullHalfLength);

      fullSnippet = "…" + fullSnippet.substring(fullIdealStart, fullIdealEnd).trim() + "…";
    }

    // Check if we have more content by comparing before any truncation happens
    const untruncatedFull = fullProcessedLines.join(" ").replace(/\s+/g, " ").trim();
    const untruncatedShort = processedLines.join(" ").replace(/\s+/g, " ").trim();
    hasMore = untruncatedFull.length > untruncatedShort.length + 50;
  }

  // Calculate the position of the index within the multi-line snippet for centering logic
  let snippetStartPos = 0;
  for (let i = 0; i < startLine; i++) {
    snippetStartPos += lines[i].length + (i < lines.length - 1 ? 1 : 0); // +1 for newline except last line
  }
  const indexInSnippet = index - snippetStartPos;

  // Check if reference is too far from center, even if snippet is under length limit
  const snippetCenter = snippet.length / 2;
  const referenceDistance = Math.abs(indexInSnippet - snippetCenter);
  const shouldCenterReference = referenceDistance > (snippet.length * 0.3); // Reference is >30% away from center

  // If snippet is too long OR reference is poorly centered, truncate while centering around the reference
  if (snippet.length > maxSnippetLength || shouldCenterReference) {

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
      truncated = "…" + truncated;
    }
    if (needsEndEllipsis) {
      truncated = truncated + "…";
    }

    snippet = truncated;
  }

  if (expandable) {
    return {
      snippet,
      fullSnippet: hasMore ? fullSnippet : undefined,
      hasMore,
    };
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
  return "…" +
    targetSentence.substring(snippetStartIndex, snippetEndIndex).trim() + "…";
}
