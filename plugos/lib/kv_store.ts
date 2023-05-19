export type KV = {
  key: string;
  value: any;
};

/**
 * An interface to any simple key-value store.
 */
export interface KVStore {
  /**
   * Deletes the value associated with a given key.
   */
  del(key: string): Promise<void>;

  /**
   * Deletes all keys that start with a specific prefix.
   */
  deletePrefix(prefix: string): Promise<void>;

  /**
   * Deletes all keys in the store.
   */
  deleteAll(): Promise<void>;

  /**
   * Sets the value for a given key.
   */
  set(key: string, value: any): Promise<void>;

  /**
   * Sets the values for a list of key-value pairs.
   */
  batchSet(kvs: KV[]): Promise<void>;

  /**
   * Deletes a list of keys.
   */
  batchDelete(keys: string[]): Promise<void>;

  /**
   * Gets the values for a list of keys.
   */
  batchGet(keys: string[]): Promise<(any | undefined)[]>;

  /**
   * Gets the value for a given key.
   */
  get(key: string): Promise<any | null>;

  /**
   * Checks whether a given key exists in the store.
   */
  has(key: string): Promise<boolean>;

  /**
   * Gets all key-value pairs where the key starts with a specific prefix.
   */
  queryPrefix(keyPrefix: string): Promise<{ key: string; value: any }[]>;
}
