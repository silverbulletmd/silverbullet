/**
 * Half-Xor sketch for Number of Distinct Values (NDV) estimation.
 *
 * Note: XOR is self-inverse, enabling O(1) delete and O(1) incremental
 * merge/subtract for index updates.
 */

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface SketchConfig {
  // Number of buckets (safe NDV capacity is approx. 3x this)
  numBuckets?: number;
}

// Common interface for all NDV sketches
export interface NDVSketch {
  add(value: string, contextTag?: string): void;
  remove(value: string): void;
  estimate(): number;
  merge(other: NDVSketch): void;
  subtract(other: NDVSketch): void;
  serialize(): string;
  clear(): void;
  readonly numBuckets: number;
}

const DEFAULT_NUM_BUCKETS = 512;
const SATURATION_WARNING_THRESHOLD = 0.01;
const SATURATION_RESET_THRESHOLD = 0.05;

export class HalfXorSketch implements NDVSketch {
  private xorMatrix: Uint32Array;
  private counters: Int32Array;
  public readonly numBuckets: number;
  private emptyCount: number;
  private saturationWarningFired = false;

  constructor(config?: SketchConfig | Uint32Array, counters?: Int32Array) {
    if (config instanceof Uint32Array) {
      this.numBuckets = config.length;
      this.xorMatrix = new Uint32Array(config);
      this.counters = counters
        ? new Int32Array(counters)
        : new Int32Array(this.numBuckets);
      this.emptyCount = 0;
      for (let i = 0; i < this.numBuckets; i++) {
        if (this.counters[i] === 0) this.emptyCount++;
      }
    } else {
      this.numBuckets = config?.numBuckets ?? DEFAULT_NUM_BUCKETS;
      this.xorMatrix = new Uint32Array(this.numBuckets);
      this.counters = new Int32Array(this.numBuckets);
      this.emptyCount = this.numBuckets;
    }
  }

  add(value: string, contextTag: string = "Unknown"): void {
    const h = fnv1a(value);
    const bucket = h % this.numBuckets;
    const fp = (h >>> 16) | 1;

    if (this.counters[bucket] === 0) {
      this.emptyCount--;
      this.checkSaturation(contextTag);
    }
    this.xorMatrix[bucket] ^= fp;
    this.counters[bucket]++;
  }

  remove(value: string): void {
    const h = fnv1a(value);
    const bucket = h % this.numBuckets;
    const fp = (h >>> 16) | 1;

    this.xorMatrix[bucket] ^= fp;
    this.counters[bucket]--;
    if (this.counters[bucket] === 0) {
      this.emptyCount++;
      if (
        this.saturationWarningFired &&
        this.emptyCount > this.numBuckets * SATURATION_RESET_THRESHOLD
      ) {
        this.saturationWarningFired = false;
      }
    }
  }

  estimate(): number {
    if (this.emptyCount === this.numBuckets) return 0;
    const v = this.emptyCount === 0 ? 1 : this.emptyCount;
    return Math.max(
      1,
      Math.round(this.numBuckets * Math.log(this.numBuckets / v)),
    );
  }

  merge(other: NDVSketch): void {
    if (!(other instanceof HalfXorSketch)) {
      throw new Error("Can only merge HalfXorSketch instances");
    }
    if (other.numBuckets !== this.numBuckets) {
      throw new Error(
        `Bucket count mismatch: ${this.numBuckets} vs ${other.numBuckets}`,
      );
    }
    for (let i = 0; i < this.numBuckets; i++) {
      const wasEmpty = this.counters[i] === 0;
      this.xorMatrix[i] ^= other.xorMatrix[i];
      this.counters[i] += other.counters[i];
      const isEmpty = this.counters[i] === 0;
      if (wasEmpty && !isEmpty) this.emptyCount--;
      else if (!wasEmpty && isEmpty) this.emptyCount++;
    }
  }

  subtract(other: NDVSketch): void {
    if (!(other instanceof HalfXorSketch)) {
      throw new Error("Can only subtract HalfXorSketch instances");
    }
    if (other.numBuckets !== this.numBuckets) {
      throw new Error(
        `Bucket count mismatch: ${this.numBuckets} vs ${other.numBuckets}`,
      );
    }
    for (let i = 0; i < this.numBuckets; i++) {
      const wasEmpty = this.counters[i] === 0;
      this.xorMatrix[i] ^= other.xorMatrix[i];
      this.counters[i] -= other.counters[i];
      const isEmpty = this.counters[i] === 0;
      if (wasEmpty && !isEmpty) this.emptyCount--;
      else if (!wasEmpty && isEmpty) this.emptyCount++;
    }
  }

  clear(): void {
    this.xorMatrix.fill(0);
    this.counters.fill(0);
    this.emptyCount = this.numBuckets;
    this.saturationWarningFired = false;
  }

  // Serialize to base64
  // Format: [numBuckets: u32][xorMatrix: u32 x n][counters: i32 x n]
  serialize(): string {
    const buf = new ArrayBuffer(4 + this.numBuckets * 8);
    const view = new DataView(buf);
    view.setUint32(0, this.numBuckets, true);
    const offset1 = 4;
    for (let i = 0; i < this.numBuckets; i++) {
      view.setUint32(offset1 + i * 4, this.xorMatrix[i], true);
    }
    const offset2 = offset1 + this.numBuckets * 4;
    for (let i = 0; i < this.numBuckets; i++) {
      view.setInt32(offset2 + i * 4, this.counters[i], true);
    }
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return btoa(s);
  }

  static deserialize(serialized: string): HalfXorSketch {
    const raw = atob(serialized);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    const view = new DataView(bytes.buffer);
    const numBuckets = view.getUint32(0, true);
    const xorMatrix = new Uint32Array(numBuckets);
    const counters = new Int32Array(numBuckets);
    const offset1 = 4;
    for (let i = 0; i < numBuckets; i++) {
      xorMatrix[i] = view.getUint32(offset1 + i * 4, true);
    }
    const offset2 = offset1 + numBuckets * 4;
    for (let i = 0; i < numBuckets; i++) {
      counters[i] = view.getInt32(offset2 + i * 4, true);
    }
    return new HalfXorSketch(xorMatrix, counters);
  }

  private checkSaturation(contextTag: string): void {
    if (this.saturationWarningFired) return;
    const threshold = Math.max(
      1,
      Math.floor(this.numBuckets * SATURATION_WARNING_THRESHOLD),
    );
    if (this.emptyCount <= threshold) {
      console.warn(
        `Planner: sketch for '${contextTag}' is approaching saturation`,
      );
      this.saturationWarningFired = true;
    }
  }
}

export function deserializeNDVSketch(serialized: string): HalfXorSketch {
  return HalfXorSketch.deserialize(serialized);
}

export function serializeNDVSketch(sketch: NDVSketch): string {
  return sketch.serialize();
}
