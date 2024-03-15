import { KV, KvKey } from "../../plug-api/types.ts";
import { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";
import { createClient, DynamoDBClient } from "../deps_server.ts";

export type AwsOptions = {
  accessKey: string;
  secretKey: string;
  region: string;
};

const keySeparator = "\0";

const batchReadSize = 100;

/**
 * Start of an implementation, to be continued at some point
 */

export class DynamoDBKvPrimitives implements KvPrimitives {
  client: DynamoDBClient;
  partitionKey: string;
  tableName: string;

  constructor(tableName: string, partitionKey: string, options: AwsOptions) {
    this.tableName = tableName;
    this.partitionKey = partitionKey;
    this.client = createClient({
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
      region: options.region,
    });
  }

  batchGet(keys: KvKey[]): Promise<any[]> {
    const allResults: any[] = [];
    const promises: Promise<any>[] = [];
    for (let i = 0; i < keys.length; i += batchReadSize) {
      const batch = keys.slice(i, i + batchReadSize);
      promises.push(
        this.client.batchGetItem(
          {
            RequestItems: {
              [this.tableName]: {
                Keys: batch.map((key) => ({
                  pk: this.partitionKey,
                  sk: key.join(keySeparator),
                })),
              },
            },
          },
        ),
      );
    }
    throw new Error("Method not implemented.");
  }
  batchSet(entries: KV[]): Promise<void> {
    throw new Error("Method not implemented.");
  }
  batchDelete(keys: KvKey[]): Promise<void> {
    throw new Error("Method not implemented.");
  }
  query(options: KvQueryOptions): AsyncIterableIterator<KV> {
    throw new Error("Method not implemented.");
  }
  close(): void {
    throw new Error("Method not implemented.");
  }
}
