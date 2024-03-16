import { stemmer } from "porter-stemmer";
import { batchSet, query } from "../index/plug_api.ts";

type ResultObject = {
  score: number;
  id: string;
};

const stopWords = ["and", "or", "the", "a", "an"];

// Tokenize text into words
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}]+/u);
}

// Remove stop words from array of words
function removeStopWords(words: string[]): string[] {
  return words.filter((word) =>
    word.length > 2 &&
    !stopWords.includes(word) && /^\p{L}+$/u.test(word)
  );
}

// Basic stemming function
function stem(word: string): string {
  return stemmer(word);
}

// Index an array of documents
export async function ftsIndexPage(
  pageName: string,
  text: string,
): Promise<void> {
  const updateIndexMap = new Map<string, number>(); // word!id -> count

  const pageNameTokens = tokenize(pageName);
  const pageContentTokens = tokenize(text);
  const words = [...pageNameTokens, ...pageContentTokens];
  const filteredWords = removeStopWords(words);
  const stemmedWords = filteredWords.map(stem);

  // Get the current IDs for these stemmed words
  // const uniqueStemmedWords = [...new Set(stemmedWords)];

  for (const stemmedWord of stemmedWords) {
    const currentFreq = updateIndexMap.get(stemmedWord) || 0;
    updateIndexMap.set(stemmedWord, currentFreq + 1);
  }

  // console.log("updateIndexMap", updateIndexMap);

  await batchSet(
    pageName,
    [...updateIndexMap.entries()].map((
      [key, value],
    ) => ({ key: ["fts", key], value })),
  );
}

// Search for a phrase and return document ids sorted by match count
export async function ftsSearch(phrase: string): Promise<ResultObject[]> {
  const words = tokenize(phrase);
  const filteredWords = removeStopWords(words);
  const stemmedWords = filteredWords.map((word) => stem(word));

  // const wordIdsArray: string[][] = await this.index.get(stemmedWords);
  const matchCounts: Map<string, number> = new Map(); // pageName -> count

  for (const stemmedWord of stemmedWords) {
    const entries = await query({
      prefix: ["fts", stemmedWord],
    });
    for (const { key, value } of entries) {
      const id = key[2];
      if (matchCounts.has(id)) {
        matchCounts.set(id, matchCounts.get(id)! + value);
      } else {
        matchCounts.set(id, value);
      }
    }
  }

  const results = Array.from(matchCounts.entries()).map(
    ([id, score]) => ({ id, score }),
  );

  return results.sort((a, b) => b.score - a.score);
}
