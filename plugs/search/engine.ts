import { stemmer } from "https://esm.sh/porter-stemmer@0.9.1";
import { KV, KvKey } from "$sb/types.ts";

export type Document = {
  id: string;
  text: string;
};

export interface BatchKVStore {
  batchSet(kvs: KV[]): Promise<void>;
  batchDel(keys: KvKey[]): Promise<void>;
  query(options: { prefix: KvKey }): Promise<KV[]>;
}

type ResultObject = {
  score: number;
  id: string;
};

export class SimpleSearchEngine {
  private stopWords = ["and", "or", "the", "a", "an"];

  constructor(
    public index: BatchKVStore,
    // public reverseIndex: BatchKVStore,
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
    const updateIndexMap = new Map<string, number>(); // word!id -> count
    const updateReverseIndexMap = new Map<string, boolean>(); // id!word -> true

    const pageContent = this.tokenize(document.text);
    const pageName = this.tokenize(document.id);
    const words = [...pageContent, ...pageName];
    const filteredWords = this.removeStopWords(words);
    const stemmedWords = filteredWords.map((word) => this.stem(word));

    // Get the current IDs for these stemmed words
    // const uniqueStemmedWords = [...new Set(stemmedWords)];

    for (const stemmedWord of stemmedWords) {
      const key = `${stemmedWord}!${document.id}`;
      const revKey = `${document.id}!${stemmedWord}`;
      const currentFreq = updateIndexMap.get(key) || 0;
      updateIndexMap.set(key, currentFreq + 1);
      updateReverseIndexMap.set(revKey, true);
    }

    // console.log("updateIndexMap", updateIndexMap);

    await this.index.batchSet(
      [...updateIndexMap.entries()].map((
        [key, value],
      ) => ({ key: ["fts", ...key.split("!")], value: value })),
    );
    await this.index.batchSet(
      [...updateReverseIndexMap.entries()].map((
        [key, value],
      ) => ({ key: ["fts_rev", ...key.split("!")], value: value })),
    );
  }

  // Search for a phrase and return document ids sorted by match count
  public async search(phrase: string): Promise<ResultObject[]> {
    const words = this.tokenize(phrase);
    const filteredWords = this.removeStopWords(words);
    const stemmedWords = filteredWords.map((word) => this.stem(word));

    // const wordIdsArray: string[][] = await this.index.get(stemmedWords);
    const matchCounts: Map<string, number> = new Map(); // pageName -> count

    for (const stemmedWord of stemmedWords) {
      const entries = await this.index.query({ prefix: ["fts", stemmedWord] });
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

  // Delete a document from the index
  public async deleteDocument(documentId: string): Promise<void> {
    const words = await this.index.query({
      prefix: ["fts_rev", documentId],
    });
    const keysToDelete: KvKey[] = [];
    for (const { key } of words) {
      const word = key[2];
      keysToDelete.push(["fts", word, documentId]);
      keysToDelete.push(key);
    }
    await this.index.batchDel(keysToDelete);
    // await this.reverseIndex.batchDel(revKeysToDelete);
  }
}
