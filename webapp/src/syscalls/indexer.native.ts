import { Indexer, KV } from "../indexer";

export default (indexer: Indexer) => ({
  "indexer.scanPrefixForPage": async (pageName: string, keyPrefix: string) => {
    return await indexer.scanPrefixForPage(pageName, keyPrefix);
  },
  "indexer.scanPrefixGlobal": async (keyPrefix: string) => {
    return await indexer.scanPrefixGlobal(keyPrefix);
  },
  "indexer.get": async (pageName: string, key: string): Promise<any> => {
    return await indexer.get(pageName, key);
  },
  "indexer.set": async (pageName: string, key: string, value: any) => {
    await indexer.set(pageName, key, value);
  },
  "indexer.batchSet": async (pageName: string, kvs: KV[]) => {
    await indexer.batchSet(pageName, kvs);
  },
  "indexer.delete": async (pageName: string, key: string) => {
    await indexer.delete(pageName, key);
  },
});
