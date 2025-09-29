/**
 * Implement out of band data augmentation operations
 */

import type { KvKey } from "@silverbulletmd/silverbullet/type/datastore";
import type { DataStore } from "./datastore.ts";

/**
 * Implements out of band augmentation of entries in a DataStore
 */
export class Augmenter {
  constructor(
    private ds: DataStore,
    private augmentationNamespace: KvKey,
  ) {
  }

  /**
   * Augments objects additional attributes pulled from a data source
   */
  async augmentObjectArray(
    objects: any[],
    keyField: string,
  ): Promise<void> {
    const objectMap = new Map<string, any>();
    // create a lookup map based on objects
    for (const obj of objects) {
      objectMap.set(obj[keyField], obj);
    }
    await this.augmentObjectMap(objectMap);
  }

  async augmentObjectMap(objectMap: Map<string, any>) {
    // Now augment
    for await (
      const augmentation of this.ds.query({
        prefix: this.augmentationNamespace,
      })
    ) {
      const obj = objectMap.get(
        augmentation.key[this.augmentationNamespace.length],
      );
      if (obj) {
        // Copy over properties from augmentation
        Object.assign(obj, augmentation.value);
      }
    }
  }

  setAugmentation(
    key: string,
    augmentation: Record<string, any>,
  ): Promise<void> {
    return this.ds.set([...this.augmentationNamespace, key], augmentation);
  }
}
