/**
 * Manages per-tag, per-column bitmap indices backed by RoaringBitmaps.
 * Uses the Dictionary for value to ID mapping.
 *
 * Storage keys (in the underlying KV store):
 *
 * - `b\0{tagId}\0{columnName}\0{valueId}` -> serialized `RoaringBitmap`
 * - `m\0{tagId}` -> `TagMeta`
 * - `$dict` -> `DictionarySnapshot`
 *
 * Object keys remain per-tag:
 *
 * - `o\0{tagId}\0{objectId}` -> encoded object
 */

import { RoaringBitmap } from "./roaring_bitmap.ts";
import { Dictionary, type DictionarySnapshot } from "./dictionary.ts";
import type { KV, KvKey } from "../../../plug-api/types/datastore.ts";

// Storage key prefixes
const BITMAP_PREFIX = "b";
const META_PREFIX = "m";
const OBJECT_PREFIX = "o";
const DICT_KEY: KvKey = ["$dict"];

// Internal metadata field
const ENC_FIELD = "$enc";

const DEFAULT_MCV_TOP_K = 10;

// Configuration

export type BitmapIndexConfig = {
  // Max selectivity (NDV/rowCount) for bitmap indexing
  maxSelectivity: number;
  // Min rows before bitmap indices activate
  minRowsForIndex: number;
  // Max encoded value length in bytes
  maxValueBytes: number;
  // Max dictionary entries (safety cap)
  maxDictionarySize: number;
  // Max bitmap keys per column (safety cap)
  maxBitmapsPerColumn: number;
  // Columns to always index regardless of selectivity
  alwaysIndexColumns: string[];
};

const DEFAULT_CONFIG: BitmapIndexConfig = {
  maxSelectivity: 0.5,
  minRowsForIndex: 50,
  maxValueBytes: 256,
  maxDictionarySize: 100000,
  maxBitmapsPerColumn: 10000,
  alwaysIndexColumns: ["page", "tag"],
};

// Tag metadata

export type ColumnMeta = {
  ndv: number;
  indexed: boolean;
};

export type TagMeta = {
  count: number;
  nextObjectId: number;
  totalColumnCount: number;
  columns: Record<string, ColumnMeta>;
};

function emptyTagMeta(): TagMeta {
  return { count: 0, nextObjectId: 0, totalColumnCount: 0, columns: {} };
}

// Encoded object

export type EncodedObject = {
  $enc: string[];
  [key: string]: unknown;
};

// Two-level bitmap cache: tagId -> column -> valueId -> RoaringBitmap

type ColumnBitmaps = Map<number, RoaringBitmap>;
type TagBitmaps = Map<string, ColumnBitmaps>;

// Structured dirty key for zero-parse flush
type DirtyBitmapEntry = {
  tagId: number;
  column: string;
  valueId: number;
};

// BitmapIndex

export class BitmapIndex {
  private dict: Dictionary;
  private config: BitmapIndexConfig;
  private metaCache: Map<number, TagMeta> = new Map();
  private bitmapsByTag: Map<number, TagBitmaps> = new Map();
  private dirtyBitmapList: DirtyBitmapEntry[] = [];
  private dirtyBitmapKeys: Set<string> = new Set();
  private dirtyMeta: Set<number> = new Set();

  constructor(config?: Partial<BitmapIndexConfig>, dict?: Dictionary) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dict = dict ?? new Dictionary();
  }

  getDictionary(): Dictionary {
    return this.dict;
  }

  getConfig(): BitmapIndexConfig {
    return this.config;
  }

  // Bitmap cache helpers

  private getOrCreateTagBitmaps(tagId: number): TagBitmaps {
    let tag = this.bitmapsByTag.get(tagId);
    if (!tag) {
      tag = new Map();
      this.bitmapsByTag.set(tagId, tag);
    }
    return tag;
  }

  private getOrCreateColumnBitmaps(
    tagBitmaps: TagBitmaps,
    column: string,
  ): ColumnBitmaps {
    let col = tagBitmaps.get(column);
    if (!col) {
      col = new Map();
      tagBitmaps.set(column, col);
    }
    return col;
  }

  private markDirty(tagId: number, column: string, valueId: number): void {
    const key = `${tagId}\0${column}\0${valueId}`;
    if (!this.dirtyBitmapKeys.has(key)) {
      this.dirtyBitmapKeys.add(key);
      this.dirtyBitmapList.push({ tagId, column, valueId });
    }
  }

  // Encoding

  encodeObject(obj: Record<string, unknown>): EncodedObject {
    const encoded: EncodedObject = { $enc: [] };
    const encFields: string[] = [];
    const maxBytes = this.config.maxValueBytes;
    const maxSize = this.config.maxDictionarySize;

    for (const [key, value] of Object.entries(obj)) {
      if (key === ENC_FIELD) continue;

      if (Array.isArray(value)) {
        const encodedArr: unknown[] = [];
        let anyEncoded = false;
        for (const elem of value) {
          const id = this.dict.encodeIfFits(elem, maxBytes, maxSize);
          if (id !== undefined) {
            encodedArr.push(id);
            anyEncoded = true;
          } else {
            encodedArr.push(elem);
          }
        }
        encoded[key] = anyEncoded ? encodedArr : value;
        if (anyEncoded) encFields.push(key);
      } else {
        const id = this.dict.encodeIfFits(value, maxBytes, maxSize);
        if (id !== undefined) {
          encoded[key] = id;
          encFields.push(key);
        } else {
          encoded[key] = value;
        }
      }
    }

    encoded.$enc = encFields;
    return encoded;
  }

  decodeObject(encoded: EncodedObject): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const encFields = new Set(encoded.$enc);

    for (const [key, value] of Object.entries(encoded)) {
      if (key === ENC_FIELD) continue;

      if (encFields.has(key)) {
        if (Array.isArray(value)) {
          result[key] = value.map((v) =>
            typeof v === "number" ? this.dict.decodeValue(v) : v,
          );
        } else if (typeof value === "number") {
          result[key] = this.dict.decodeValue(value);
        } else {
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  // Storage key constructors

  private bitmapStorageKey(
    tagId: number,
    column: string,
    valueId: number,
  ): KvKey {
    return [BITMAP_PREFIX, String(tagId), column, String(valueId)];
  }

  private metaStorageKey(tagId: number): KvKey {
    return [META_PREFIX, String(tagId)];
  }

  objectStorageKey(tagId: number, objectId: number): KvKey {
    return [OBJECT_PREFIX, String(tagId), String(objectId)];
  }

  // Column indexing decision

  shouldIndexColumn(column: string, tagMeta: TagMeta): boolean {
    if (this.config.alwaysIndexColumns.includes(column)) return true;
    if (tagMeta.count < this.config.minRowsForIndex) return false;

    const colMeta = tagMeta.columns[column];
    if (!colMeta) return true;

    if (colMeta.ndv > this.config.maxBitmapsPerColumn) return false;
    if (
      tagMeta.count > 0 &&
      colMeta.ndv / tagMeta.count > this.config.maxSelectivity
    ) {
      return false;
    }
    return true;
  }

  // Tag metadata

  getTagMeta(tag: string): { tagId: number; meta: TagMeta } {
    const tagId = this.dict.encode(tag);
    let meta = this.metaCache.get(tagId);
    if (!meta) {
      meta = emptyTagMeta();
      this.metaCache.set(tagId, meta);
    }
    return { tagId, meta };
  }

  allocateObjectId(tagId: number): number {
    const meta = this.metaCache.get(tagId)!;
    const id = meta.nextObjectId;
    meta.nextObjectId++;
    meta.count++;
    this.dirtyMeta.add(tagId);
    return id;
  }

  // Unified bit operations

  setBit(
    tagId: number,
    column: string,
    valueId: number,
    objectId: number,
  ): boolean {
    const tagBitmaps = this.getOrCreateTagBitmaps(tagId);
    const colBitmaps = this.getOrCreateColumnBitmaps(tagBitmaps, column);
    let bm = colBitmaps.get(valueId);
    const wasEmpty = !bm || bm.isEmpty();
    if (!bm) {
      bm = new RoaringBitmap();
      colBitmaps.set(valueId, bm);
    }
    bm.add(objectId);
    this.markDirty(tagId, column, valueId);
    return wasEmpty;
  }

  // Clear a bit from a bitmap index. Returns true if the bitmap is empty.
  clearBit(
    tagId: number,
    column: string,
    valueId: number,
    objectId: number,
  ): boolean {
    const colBitmaps = this.bitmapsByTag.get(tagId)?.get(column);
    if (!colBitmaps) return false;
    const bm = colBitmaps.get(valueId);
    if (!bm) return false;
    bm.remove(objectId);
    this.markDirty(tagId, column, valueId);
    return bm.isEmpty();
  }

  // Get bitmap for a specific tag/column/value.
  getBitmap(
    tagId: number,
    column: string,
    valueId: number,
  ): RoaringBitmap | undefined {
    return this.bitmapsByTag.get(tagId)?.get(column)?.get(valueId);
  }

  // Get all value IDs that have a bitmap stored for the given tag and column.
  getColumnValueIds(tagId: number, column: string): number[] {
    const colMap = this.bitmapsByTag.get(tagId)?.get(column);
    if (!colMap) return [];
    return [...colMap.keys()];
  }

  // Unified index/unindex via walkObjectFields

  // Index an encoded object: set bits in all relevant column bitmaps.
  indexObject(
    tagId: number,
    objectId: number,
    encoded: EncodedObject,
    meta: TagMeta,
  ): void {
    this.walkObjectFields(tagId, objectId, encoded, meta, "index");
  }

  // Remove an object from all bitmap indices.
  unindexObject(
    tagId: number,
    objectId: number,
    encoded: EncodedObject,
    meta: TagMeta,
  ): void {
    this.walkObjectFields(tagId, objectId, encoded, meta, "unindex");
  }

  private walkObjectFields(
    tagId: number,
    objectId: number,
    encoded: EncodedObject,
    meta: TagMeta,
    mode: "index" | "unindex",
  ): void {
    let objectColumnCount = 0;
    const encodedFields = new Set(encoded.$enc);
    const dict = this.dict;

    for (const [key, value] of Object.entries(encoded)) {
      if (key === ENC_FIELD) continue;
      objectColumnCount++;

      if (mode === "index") {
        if (!meta.columns[key]) {
          meta.columns[key] = { ndv: 0, indexed: true };
        }
      } else {
        if (!meta.columns[key]?.indexed) continue;
      }

      const isEnc = encodedFields.has(key);
      const values = Array.isArray(value) ? value : [value];

      for (const elem of values) {
        let valueId: number | undefined;
        if (typeof elem === "number" && isEnc) {
          valueId = elem;
        } else if (mode === "index") {
          valueId = dict.encode(elem);
        } else {
          valueId = dict.tryEncode(elem);
        }

        if (valueId === undefined) continue;

        if (mode === "index") {
          if (this.setBit(tagId, key, valueId, objectId)) {
            meta.columns[key].ndv++;
          }
        } else {
          if (this.clearBit(tagId, key, valueId, objectId)) {
            if (meta.columns[key]) {
              meta.columns[key].ndv = Math.max(0, meta.columns[key].ndv - 1);
            }
          }
        }
      }
    }

    if (mode === "index") {
      meta.totalColumnCount += objectColumnCount;
    } else {
      meta.totalColumnCount = Math.max(
        0,
        meta.totalColumnCount - objectColumnCount,
      );
      meta.count = Math.max(0, meta.count - 1);
    }
    this.dirtyMeta.add(tagId);
  }

  // NDV recomputation

  recomputeNDV(tagId: number, meta: TagMeta): void {
    for (const col of Object.keys(meta.columns)) {
      meta.columns[col].ndv = 0;
    }

    const tagBitmaps = this.bitmapsByTag.get(tagId);
    if (tagBitmaps) {
      for (const [column, colBitmaps] of tagBitmaps) {
        if (!meta.columns[column]) continue;
        let count = 0;
        for (const bm of colBitmaps.values()) {
          if (!bm.isEmpty()) count++;
        }
        meta.columns[column].ndv = count;
      }
    }

    for (const [col, colMeta] of Object.entries(meta.columns)) {
      colMeta.indexed = this.shouldIndexColumn(col, meta);
    }

    this.dirtyMeta.add(tagId);
  }

  recomputeAllNDV(): void {
    for (const [tagId, meta] of this.metaCache) {
      this.recomputeNDV(tagId, meta);
    }
  }

  // Stats

  getColumnNDV(tagId: number, column: string): number {
    return this.metaCache.get(tagId)?.columns[column]?.ndv ?? 0;
  }

  getColumnMCV(
    tagId: number,
    column: string,
    topK: number = DEFAULT_MCV_TOP_K,
  ): { value: string; count: number }[] {
    const colBitmaps = this.bitmapsByTag.get(tagId)?.get(column);
    if (!colBitmaps) return [];

    const entries: { valueId: number; count: number }[] = [];
    for (const [valueId, bm] of colBitmaps) {
      if (!bm.isEmpty()) {
        entries.push({ valueId, count: bm.cardinality() });
      }
    }

    entries.sort((a, b) => b.count - a.count);
    const topEntries = entries.slice(0, topK);

    return topEntries.map(({ valueId, count }) => ({
      value: String(this.dict.decodeValue(valueId) ?? valueId),
      count,
    }));
  }

  getRowCount(tagId: number): number {
    return this.metaCache.get(tagId)?.count ?? 0;
  }

  // Persistence

  flushToKVs(): { writes: KV[]; deletes: KvKey[] } {
    const writes: KV[] = [];
    const deletes: KvKey[] = [];

    for (const { tagId, column, valueId } of this.dirtyBitmapList) {
      const storageKey = this.bitmapStorageKey(tagId, column, valueId);
      const bm = this.bitmapsByTag.get(tagId)?.get(column)?.get(valueId);

      if (!bm || bm.isEmpty()) {
        deletes.push(storageKey);
        this.bitmapsByTag.get(tagId)?.get(column)?.delete(valueId);
      } else {
        writes.push({ key: storageKey, value: bm.serialize() });
      }
    }
    this.dirtyBitmapList = [];
    this.dirtyBitmapKeys.clear();

    for (const tagId of this.dirtyMeta) {
      const meta = this.metaCache.get(tagId);
      if (meta) {
        writes.push({ key: this.metaStorageKey(tagId), value: meta });
      }
    }
    this.dirtyMeta.clear();

    if (this.dict.dirty) {
      writes.push({ key: DICT_KEY, value: this.dict.toSnapshot() });
      this.dict.clearDirty();
    }

    return { writes, deletes };
  }

  // Loading

  loadDictionary(snapshot: DictionarySnapshot): void {
    this.dict = new Dictionary(snapshot);
  }

  loadTagMeta(tagId: number, meta: TagMeta): void {
    this.metaCache.set(tagId, meta);
  }

  loadBitmap(
    tagId: number,
    column: string,
    valueId: number,
    data: Uint8Array,
  ): void {
    const tagBitmaps = this.getOrCreateTagBitmaps(tagId);
    const colBitmaps = this.getOrCreateColumnBitmaps(tagBitmaps, column);
    colBitmaps.set(valueId, RoaringBitmap.deserialize(data));
  }

  clear(): void {
    this.dict = new Dictionary();
    this.metaCache.clear();
    this.bitmapsByTag.clear();
    this.dirtyBitmapList = [];
    this.dirtyBitmapKeys.clear();
    this.dirtyMeta.clear();
  }

  allTagIds(): number[] {
    return [...this.metaCache.keys()];
  }

  getTagMetaById(tagId: number): TagMeta | undefined {
    return this.metaCache.get(tagId);
  }

  getColumnBitmaps(tagId: number, column: string): RoaringBitmap[] {
    const colBitmaps = this.bitmapsByTag.get(tagId)?.get(column);
    if (!colBitmaps) return [];
    const results: RoaringBitmap[] = [];
    for (const bm of colBitmaps.values()) {
      if (!bm.isEmpty()) {
        results.push(bm);
      }
    }
    return results;
  }
}
