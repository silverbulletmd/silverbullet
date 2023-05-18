import { c } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/clike?external=@codemirror/language";
import { stemmer } from "https://esm.sh/porter-stemmer@0.9.1";

export type Document = {
  id: string;
  text: string;
};

export interface BatchKVStore<K, V> {
  get(keys: K[]): Promise<(V | undefined)[]>;
  set(entries: Map<K, V>): Promise<void>;
  delete(keys: K[]): Promise<void>;
}

type ResultObject = {
  score: number;
  id: string;
};

export class SimpleSearchEngine {
  private stopWords = ["and", "or", "the", "a", "an"];

  constructor(
    public index: BatchKVStore<string, string[]>,
    public reverseIndex: BatchKVStore<string, string[]>,
  ) {
  }

  // Tokenize text into words
  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/[^\p{L}]+/u);
  }

  // Remove stop words from array of words
  private removeStopWords(words: string[]): string[] {
    return words.filter((word) =>
      word.length > 2 &&
      !this.stopWords.includes(word) && /^\p{L}+$/u.test(word)
    );
  }

  // Basic stemming function
  private stem(word: string): string {
    return stemmer(word);
  }

  // Index an array of documents
  public async indexDocument(document: Document): Promise<void> {
    const updateIndexMap = new Map<string, string[]>();
    const updateReverseIndexMap = new Map<string, string[]>();

    const words = this.tokenize(document.text);
    const filteredWords = this.removeStopWords(words);
    const stemmedWords = filteredWords.map((word) => this.stem(word));

    // Get the current IDs for these stemmed words
    const uniqueStemmedWords = [...new Set(stemmedWords)];
    const currentIdsArray = await this.index.get(uniqueStemmedWords);

    stemmedWords.forEach((stemmedWord, i) => {
      const currentIds =
        currentIdsArray[uniqueStemmedWords.indexOf(stemmedWord)] || [];

      currentIds.push(document.id);
      updateIndexMap.set(stemmedWord, currentIds);

      if (!updateReverseIndexMap.has(document.id)) {
        updateReverseIndexMap.set(document.id, []);
      }

      if (!updateReverseIndexMap.get(document.id)!.includes(stemmedWord)) {
        updateReverseIndexMap.get(document.id)!.push(stemmedWord);
      }
    });

    // console.log("updateIndexMap", updateIndexMap);

    await this.index.set(updateIndexMap);
    await this.reverseIndex.set(updateReverseIndexMap);
  }

  // Search for a phrase and return document ids sorted by match count
  public async search(phrase: string): Promise<ResultObject[]> {
    const words = this.tokenize(phrase);
    const filteredWords = this.removeStopWords(words);
    const stemmedWords = filteredWords.map((word) => this.stem(word));

    const wordIdsArray = await this.index.get(stemmedWords);
    const matchCounts: Map<string, number> = new Map();

    wordIdsArray.forEach((wordIds) => {
      if (wordIds) {
        wordIds.forEach((id) => {
          if (matchCounts.has(id)) {
            matchCounts.set(id, matchCounts.get(id)! + 1);
          } else {
            matchCounts.set(id, 1);
          }
        });
      }
    });

    const results = Array.from(matchCounts.entries()).map(
      ([id, score]) => ({ id, score }),
    );

    return results.sort((a, b) => b.score - a.score);
  }

  // Delete a document from the index
  public async deleteDocument(documentId: string): Promise<void> {
    const words = await this.reverseIndex.get([documentId]);
    if (words && words[0]) {
      const currentIdsArray = await this.index.get(words[0]);
      const deleteKeys: string[] = [];
      const updateMap = new Map<string, string[]>();

      words[0].forEach((word, i) => {
        const currentIds = currentIdsArray[i];
        if (currentIds) {
          const updatedIds = currentIds.filter((id) => id !== documentId);
          if (updatedIds.length > 0) {
            updateMap.set(word, updatedIds);
          } else {
            deleteKeys.push(word);
          }
        }
      });

      if (deleteKeys.length > 0) {
        await this.index.delete(deleteKeys);
      }
      if (updateMap.size > 0) {
        await this.index.set(updateMap);
      }

      await this.reverseIndex.delete([documentId]);
    }
  }
}
