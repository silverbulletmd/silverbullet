import { Space, KV } from "../space";

export default (space: Space) => ({
  "indexer.scanPrefixForPage": async (pageName: string, keyPrefix: string) => {
    return await space.indexScanPrefixForPage(pageName, keyPrefix);
  },
  "indexer.scanPrefixGlobal": async (keyPrefix: string) => {
    return await space.indexScanPrefixGlobal(keyPrefix);
  },
  "indexer.get": async (pageName: string, key: string): Promise<any> => {
    return await space.indexGet(pageName, key);
  },
  "indexer.set": async (pageName: string, key: string, value: any) => {
    await space.indexSet(pageName, key, value);
  },
  "indexer.batchSet": async (pageName: string, kvs: KV[]) => {
    await space.indexBatchSet(pageName, kvs);
  },
  "indexer.delete": async (pageName: string, key: string) => {
    await space.indexDelete(pageName, key);
  },
});
