const ARRAY_MAX = 4096;

enum ContainerType {
  Array = 0,
  Bitmap = 1,
  Run = 2,
}

interface Container {
  add(lsb: number): Container;
  remove(lsb: number): Container;
  has(lsb: number): boolean;
  cardinality: number;
  isEmpty(): boolean;
  and(other: Container): Container;
  or(other: Container): Container;
  andNot(other: Container): Container;
  toArray(): number[];
  serialize(view: DataView, offset: number): number;
  readonly containerType: ContainerType;
}

class ArrayContainer implements Container {
  readonly containerType = ContainerType.Array;
  data: Uint16Array;
  cardinality: number;

  constructor(data?: Uint16Array, cardinality?: number) {
    this.data = data ?? new Uint16Array(4);
    this.cardinality = cardinality ?? 0;
  }

  add(lsb: number): Container {
    const pos = bsearch(this.data, this.cardinality, lsb);
    if (pos >= 0) return this;
    const ins = ~pos;
    if (this.cardinality + 1 >= ARRAY_MAX) {
      const bc = new BitmapContainer();
      for (let i = 0; i < this.cardinality; i++) bc.setBit(this.data[i]);
      bc.setBit(lsb);
      return bc;
    }
    if (this.cardinality >= this.data.length) {
      const next = new Uint16Array(Math.min(this.data.length * 2, ARRAY_MAX));
      next.set(this.data);
      this.data = next;
    }
    this.data.copyWithin(ins + 1, ins, this.cardinality);
    this.data[ins] = lsb;
    this.cardinality++;
    return this;
  }

  remove(lsb: number): Container {
    const pos = bsearch(this.data, this.cardinality, lsb);
    if (pos < 0) return this;
    this.data.copyWithin(pos, pos + 1, this.cardinality);
    this.cardinality--;
    return this;
  }

  has(lsb: number): boolean {
    return bsearch(this.data, this.cardinality, lsb) >= 0;
  }

  isEmpty(): boolean {
    return this.cardinality === 0;
  }

  and(other: Container): Container {
    if (other instanceof ArrayContainer) return andArrayArray(this, other);
    return filterArray(this, other, true);
  }

  or(other: Container): Container {
    if (other instanceof ArrayContainer) return orArrayArray(this, other);
    if (other instanceof BitmapContainer) return orArrayBitmap(this, other);
    return orArrayRun(this, other as RunContainer);
  }

  andNot(other: Container): Container {
    if (other instanceof ArrayContainer) return andNotArrayArray(this, other);
    return filterArray(this, other, false);
  }

  toArray(): number[] {
    const out = new Array(this.cardinality);
    for (let i = 0; i < this.cardinality; i++) out[i] = this.data[i];
    return out;
  }

  serialize(view: DataView, offset: number): number {
    for (let i = 0; i < this.cardinality; i++) {
      view.setUint16(offset, this.data[i], true);
      offset += 2;
    }
    return this.cardinality * 2;
  }
}

class BitmapContainer implements Container {
  readonly containerType = ContainerType.Bitmap;
  data: Uint32Array;
  cardinality: number;

  constructor(data?: Uint32Array, cardinality?: number) {
    this.data = data ?? new Uint32Array(2048);
    this.cardinality = cardinality ?? 0;
  }

  setBit(lsb: number): void {
    const word = lsb >>> 5;
    const bit = 1 << (lsb & 31);
    if (!(this.data[word] & bit)) {
      this.data[word] |= bit;
      this.cardinality++;
    }
  }

  add(lsb: number): Container {
    this.setBit(lsb);
    return this;
  }

  remove(lsb: number): Container {
    const word = lsb >>> 5;
    const bit = 1 << (lsb & 31);
    if (this.data[word] & bit) {
      this.data[word] &= ~bit;
      this.cardinality--;
      if (this.cardinality < ARRAY_MAX) return this.toArrayContainer();
    }
    return this;
  }

  has(lsb: number): boolean {
    return (this.data[lsb >>> 5] & (1 << (lsb & 31))) !== 0;
  }

  isEmpty(): boolean {
    return this.cardinality === 0;
  }

  and(other: Container): Container {
    if (other instanceof BitmapContainer)
      return bitmapWordOp(this, other, (x, y) => x & y);
    if (other instanceof ArrayContainer) return filterArray(other, this, true);
    return bitmapRunOp(this, other as RunContainer, "and");
  }

  or(other: Container): Container {
    if (other instanceof BitmapContainer)
      return bitmapWordOp(this, other, (x, y) => x | y);
    if (other instanceof ArrayContainer) return orArrayBitmap(other, this);
    return bitmapRunOp(this, other as RunContainer, "or");
  }

  andNot(other: Container): Container {
    if (other instanceof BitmapContainer)
      return bitmapWordOp(this, other, (x, y) => x & ~y);
    if (other instanceof ArrayContainer) return andNotBitmapArray(this, other);
    return bitmapRunOp(this, other as RunContainer, "andnot");
  }

  toArray(): number[] {
    const out: number[] = [];
    for (let w = 0; w < 2048; w++) {
      let word = this.data[w];
      while (word !== 0) {
        const t = word & -word;
        out.push((w << 5) + popcount(t - 1));
        word ^= t;
      }
    }
    return out;
  }

  serialize(view: DataView, offset: number): number {
    for (let i = 0; i < 2048; i++) {
      view.setUint32(offset, this.data[i], true);
      offset += 4;
    }
    return 8192;
  }

  private toArrayContainer(): ArrayContainer {
    const arr = new Uint16Array(this.cardinality);
    let idx = 0;
    for (let w = 0; w < 2048; w++) {
      let word = this.data[w];
      while (word !== 0) {
        const t = word & -word;
        arr[idx++] = (w << 5) + popcount(t - 1);
        word ^= t;
      }
    }
    return new ArrayContainer(arr, this.cardinality);
  }
}

class RunContainer implements Container {
  readonly containerType = ContainerType.Run;
  runs: Uint16Array;
  numRuns: number;
  cardinality: number;

  constructor(runs?: Uint16Array, numRuns?: number) {
    this.runs = runs ?? new Uint16Array(8);
    this.numRuns = numRuns ?? 0;
    this.cardinality = 0;
    if (numRuns) this.recomputeCardinality();
  }

  private recomputeCardinality(): void {
    let c = 0;
    for (let i = 0; i < this.numRuns; i++) c += this.runs[i * 2 + 1] + 1;
    this.cardinality = c;
  }

  add(lsb: number): Container {
    let lo = 0;
    let hi = this.numRuns;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.runs[mid * 2] + this.runs[mid * 2 + 1] < lsb) lo = mid + 1;
      else hi = mid;
    }

    if (lo < this.numRuns) {
      const s = this.runs[lo * 2];
      const l = this.runs[lo * 2 + 1];
      if (lsb >= s && lsb <= s + l) return this;
    }

    const canExtendPrev =
      lo > 0 &&
      this.runs[(lo - 1) * 2] + this.runs[(lo - 1) * 2 + 1] + 1 === lsb;
    const canExtendNext = lo < this.numRuns && this.runs[lo * 2] === lsb + 1;
    const canMerge = canExtendPrev && canExtendNext;

    if (canMerge) {
      const prevIdx = lo - 1;
      const prevStart = this.runs[prevIdx * 2];
      const nextEnd = this.runs[lo * 2] + this.runs[lo * 2 + 1];
      this.runs[prevIdx * 2 + 1] = nextEnd - prevStart;
      this.removeRun(lo);
      this.cardinality++;
    } else if (canExtendPrev) {
      this.runs[(lo - 1) * 2 + 1]++;
      this.cardinality++;
    } else if (canExtendNext) {
      this.runs[lo * 2] = lsb;
      this.runs[lo * 2 + 1]++;
      this.cardinality++;
    } else {
      this.insertRun(lo, lsb, 0);
      this.cardinality++;
    }
    return this.maybeConvert();
  }

  remove(lsb: number): Container {
    for (let i = 0; i < this.numRuns; i++) {
      const s = this.runs[i * 2];
      const l = this.runs[i * 2 + 1];
      if (lsb < s) return this;
      if (lsb > s + l) continue;

      this.cardinality--;
      if (l === 0) {
        this.removeRun(i);
      } else if (lsb === s) {
        this.runs[i * 2] = s + 1;
        this.runs[i * 2 + 1] = l - 1;
      } else if (lsb === s + l) {
        this.runs[i * 2 + 1] = l - 1;
      } else {
        const newLen1 = lsb - s - 1;
        const newStart2 = lsb + 1;
        const newLen2 = s + l - lsb - 1;
        this.runs[i * 2 + 1] = newLen1;
        this.insertRun(i + 1, newStart2, newLen2);
      }
      return this.maybeConvert();
    }
    return this;
  }

  has(lsb: number): boolean {
    let lo = 0;
    let hi = this.numRuns - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const s = this.runs[mid * 2];
      const e = s + this.runs[mid * 2 + 1];
      if (lsb < s) hi = mid - 1;
      else if (lsb > e) lo = mid + 1;
      else return true;
    }
    return false;
  }

  isEmpty(): boolean {
    return this.numRuns === 0;
  }

  and(other: Container): Container {
    if (other instanceof RunContainer) return andRunRun(this, other);
    if (other instanceof ArrayContainer) return filterArray(other, this, true);
    return bitmapRunOp(other as BitmapContainer, this, "and");
  }

  or(other: Container): Container {
    if (other instanceof RunContainer) return orRunRun(this, other);
    if (other instanceof ArrayContainer) return orArrayRun(other, this);
    return bitmapRunOp(other as BitmapContainer, this, "or");
  }

  andNot(other: Container): Container {
    if (other instanceof RunContainer) return andNotRunRun(this, other);
    return filterRunThrough(this, other, false);
  }

  toArray(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.numRuns; i++) {
      const s = this.runs[i * 2];
      const l = this.runs[i * 2 + 1];
      for (let v = s; v <= s + l; v++) out.push(v);
    }
    return out;
  }

  serialize(view: DataView, offset: number): number {
    for (let i = 0; i < this.numRuns; i++) {
      view.setUint16(offset, this.runs[i * 2], true);
      offset += 2;
      view.setUint16(offset, this.runs[i * 2 + 1], true);
      offset += 2;
    }
    return this.numRuns * 4;
  }

  private insertRun(pos: number, start: number, length: number): void {
    if ((this.numRuns + 1) * 2 > this.runs.length) {
      const next = new Uint16Array(this.runs.length * 2);
      next.set(this.runs);
      this.runs = next;
    }
    for (let i = this.numRuns - 1; i >= pos; i--) {
      this.runs[(i + 1) * 2] = this.runs[i * 2];
      this.runs[(i + 1) * 2 + 1] = this.runs[i * 2 + 1];
    }
    this.runs[pos * 2] = start;
    this.runs[pos * 2 + 1] = length;
    this.numRuns++;
  }

  private removeRun(pos: number): void {
    for (let i = pos; i < this.numRuns - 1; i++) {
      this.runs[i * 2] = this.runs[(i + 1) * 2];
      this.runs[i * 2 + 1] = this.runs[(i + 1) * 2 + 1];
    }
    this.numRuns--;
  }

  private maybeConvert(): Container {
    if (this.cardinality >= ARRAY_MAX && this.numRuns > 2048) {
      return this.toBitmap();
    }
    if (this.cardinality < ARRAY_MAX && 2 * this.numRuns >= this.cardinality) {
      return this.toArrayContainer();
    }
    return this;
  }

  toBitmap(): BitmapContainer {
    const bc = new BitmapContainer();
    for (let i = 0; i < this.numRuns; i++) {
      const s = this.runs[i * 2];
      const l = this.runs[i * 2 + 1];
      for (let v = s; v <= s + l; v++) bc.setBit(v);
    }
    return bc;
  }

  private toArrayContainer(): ArrayContainer {
    const arr = new Uint16Array(this.cardinality);
    let idx = 0;
    for (let i = 0; i < this.numRuns; i++) {
      const s = this.runs[i * 2];
      const l = this.runs[i * 2 + 1];
      for (let v = s; v <= s + l; v++) arr[idx++] = v;
    }
    return new ArrayContainer(arr, this.cardinality);
  }
}

// Generic cross-container helpers

function filterArray(
  a: ArrayContainer,
  b: Container,
  keep: boolean,
): Container {
  const out = new Uint16Array(a.cardinality);
  let k = 0;
  for (let i = 0; i < a.cardinality; i++) {
    if (b.has(a.data[i]) === keep) out[k++] = a.data[i];
  }
  return new ArrayContainer(out.slice(0, k), k);
}

function bitmapWordOp(
  a: BitmapContainer,
  b: BitmapContainer,
  op: (x: number, y: number) => number,
): Container {
  const data = new Uint32Array(2048);
  let card = 0;
  for (let i = 0; i < 2048; i++) {
    const w = op(a.data[i], b.data[i]);
    data[i] = w;
    card += popcount(w);
  }
  if (card < ARRAY_MAX) return bitmapToArray(data, card);
  return new BitmapContainer(data, card);
}

function bitmapRunOp(
  a: BitmapContainer,
  b: RunContainer,
  action: "and" | "or" | "andnot",
): Container {
  const data =
    action === "and" ? new Uint32Array(2048) : new Uint32Array(a.data);
  let card = action === "and" ? 0 : a.cardinality;

  for (let i = 0; i < b.numRuns; i++) {
    const s = b.runs[i * 2];
    const e = s + b.runs[i * 2 + 1];
    for (let v = s; v <= e; v++) {
      const word = v >>> 5;
      const bit = 1 << (v & 31);
      if (action === "and") {
        if (a.data[word] & bit) {
          data[word] |= bit;
          card++;
        }
      } else if (action === "or") {
        if (!(data[word] & bit)) {
          data[word] |= bit;
          card++;
        }
      } else {
        if (data[word] & bit) {
          data[word] &= ~bit;
          card--;
        }
      }
    }
  }

  if (card < ARRAY_MAX) return bitmapToArray(data, card);
  return new BitmapContainer(data, card);
}

function filterRunThrough(
  a: RunContainer,
  b: Container,
  keep: boolean,
): Container {
  const out: number[] = [];
  for (let i = 0; i < a.numRuns; i++) {
    const s = a.runs[i * 2];
    const l = a.runs[i * 2 + 1];
    for (let v = s; v <= s + l; v++) {
      if (b.has(v) === keep) out.push(v);
    }
  }
  if (out.length >= ARRAY_MAX) {
    const bc = new BitmapContainer();
    for (const v of out) bc.setBit(v);
    return bc;
  }
  return new ArrayContainer(new Uint16Array(out), out.length);
}

// Specific cross-container operations (unique logic)

function andArrayArray(a: ArrayContainer, b: ArrayContainer): Container {
  const out = new Uint16Array(Math.min(a.cardinality, b.cardinality));
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.cardinality && j < b.cardinality) {
    const va = a.data[i];
    const vb = b.data[j];
    if (va === vb) {
      out[k++] = va;
      i++;
      j++;
    } else if (va < vb) {
      i++;
    } else {
      j++;
    }
  }
  return new ArrayContainer(out.slice(0, k), k);
}

function andRunRun(a: RunContainer, b: RunContainer): Container {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.numRuns && j < b.numRuns) {
    const as = a.runs[i * 2];
    const ae = as + a.runs[i * 2 + 1];
    const bs = b.runs[j * 2];
    const be = bs + b.runs[j * 2 + 1];
    const lo = Math.max(as, bs);
    const hi = Math.min(ae, be);
    if (lo <= hi) {
      out.push(lo, hi - lo);
    }
    if (ae < be) i++;
    else j++;
  }
  const runs = new Uint16Array(out);
  return optimizeContainer(new RunContainer(runs, out.length >>> 1));
}

function orArrayArray(a: ArrayContainer, b: ArrayContainer): Container {
  const out = new Uint16Array(a.cardinality + b.cardinality);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.cardinality && j < b.cardinality) {
    const va = a.data[i];
    const vb = b.data[j];
    if (va === vb) {
      out[k++] = va;
      i++;
      j++;
    } else if (va < vb) {
      out[k++] = va;
      i++;
    } else {
      out[k++] = vb;
      j++;
    }
  }
  while (i < a.cardinality) out[k++] = a.data[i++];
  while (j < b.cardinality) out[k++] = b.data[j++];
  if (k >= ARRAY_MAX) {
    const bc = new BitmapContainer();
    for (let n = 0; n < k; n++) bc.setBit(out[n]);
    return bc;
  }
  return new ArrayContainer(out.slice(0, k), k);
}

function orArrayBitmap(a: ArrayContainer, b: BitmapContainer): Container {
  const data = new Uint32Array(b.data);
  let card = b.cardinality;
  for (let i = 0; i < a.cardinality; i++) {
    const v = a.data[i];
    const word = v >>> 5;
    const bit = 1 << (v & 31);
    if (!(data[word] & bit)) {
      data[word] |= bit;
      card++;
    }
  }
  return new BitmapContainer(data, card);
}

function orArrayRun(a: ArrayContainer, b: RunContainer): Container {
  if (b.cardinality >= ARRAY_MAX) {
    return orArrayBitmap(a, b.toBitmap());
  }
  const arr = b.toArray();
  const bc = new ArrayContainer(new Uint16Array(arr), arr.length);
  return orArrayArray(a, bc);
}

function orRunRun(a: RunContainer, b: RunContainer): Container {
  const merged: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.numRuns || j < b.numRuns) {
    let s: number;
    let e: number;
    if (j >= b.numRuns || (i < a.numRuns && a.runs[i * 2] <= b.runs[j * 2])) {
      s = a.runs[i * 2];
      e = s + a.runs[i * 2 + 1];
      i++;
    } else {
      s = b.runs[j * 2];
      e = s + b.runs[j * 2 + 1];
      j++;
    }
    if (merged.length > 0) {
      const prevEnd = merged[merged.length - 2] + merged[merged.length - 1];
      if (s <= prevEnd + 1) {
        const newEnd = Math.max(prevEnd, e);
        merged[merged.length - 1] = newEnd - merged[merged.length - 2];
        continue;
      }
    }
    merged.push(s, e - s);
  }
  const runs = new Uint16Array(merged);
  return optimizeContainer(new RunContainer(runs, merged.length >>> 1));
}

function andNotArrayArray(a: ArrayContainer, b: ArrayContainer): Container {
  const out = new Uint16Array(a.cardinality);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.cardinality) {
    if (j >= b.cardinality) {
      out[k++] = a.data[i++];
    } else if (a.data[i] < b.data[j]) {
      out[k++] = a.data[i++];
    } else if (a.data[i] === b.data[j]) {
      i++;
      j++;
    } else {
      j++;
    }
  }
  return new ArrayContainer(out.slice(0, k), k);
}

function andNotBitmapArray(a: BitmapContainer, b: ArrayContainer): Container {
  const data = new Uint32Array(a.data);
  let card = a.cardinality;
  for (let i = 0; i < b.cardinality; i++) {
    const v = b.data[i];
    const word = v >>> 5;
    const bit = 1 << (v & 31);
    if (data[word] & bit) {
      data[word] &= ~bit;
      card--;
    }
  }
  if (card < ARRAY_MAX) return bitmapToArray(data, card);
  return new BitmapContainer(data, card);
}

function andNotRunRun(a: RunContainer, b: RunContainer): Container {
  if (a.cardinality >= ARRAY_MAX || b.cardinality >= ARRAY_MAX) {
    return bitmapRunOp(a.toBitmap(), b, "andnot");
  }
  return filterRunThrough(a, b, false);
}

// Helpers

function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function bsearch(arr: Uint16Array, len: number, target: number): number {
  let lo = 0;
  let hi = len - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = arr[mid];
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return ~lo;
}

function bsearchInsert(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function optimizeContainer(c: Container): Container {
  if (c instanceof RunContainer) {
    if (c.cardinality < ARRAY_MAX && 2 * c.numRuns >= c.cardinality) {
      const arr = c.toArray();
      return new ArrayContainer(new Uint16Array(arr), arr.length);
    }
    if (c.cardinality >= ARRAY_MAX && c.numRuns > 2048) {
      return c.toBitmap();
    }
  }
  return c;
}

function bitmapToArray(data: Uint32Array, cardinality: number): ArrayContainer {
  const arr = new Uint16Array(cardinality);
  let idx = 0;
  for (let w = 0; w < 2048; w++) {
    let word = data[w];
    while (word !== 0) {
      const t = word & -word;
      arr[idx++] = (w << 5) + popcount(t - 1);
      word ^= t;
    }
  }
  return new ArrayContainer(arr, cardinality);
}

export class RoaringBitmap {
  private containers: Map<number, Container> = new Map();
  private keys: number[] = [];

  add(value: number): void {
    const msb = value >>> 16;
    const lsb = value & 0xffff;
    let container = this.containers.get(msb);
    if (!container) {
      container = new ArrayContainer();
      this.containers.set(msb, container);
      const pos = bsearchInsert(this.keys, msb);
      this.keys.splice(pos, 0, msb);
    }
    const next = container.add(lsb);
    if (next !== container) this.containers.set(msb, next);
  }

  remove(value: number): void {
    const msb = value >>> 16;
    const lsb = value & 0xffff;
    const container = this.containers.get(msb);
    if (!container) return;
    const next = container.remove(lsb);
    if (next.isEmpty()) {
      this.containers.delete(msb);
      const pos = this.keys.indexOf(msb);
      if (pos >= 0) this.keys.splice(pos, 1);
    } else if (next !== container) {
      this.containers.set(msb, next);
    }
  }

  has(value: number): boolean {
    const container = this.containers.get(value >>> 16);
    return container ? container.has(value & 0xffff) : false;
  }

  cardinality(): number {
    let c = 0;
    for (const container of this.containers.values())
      c += container.cardinality;
    return c;
  }

  isEmpty(): boolean {
    return this.keys.length === 0;
  }

  toArray(): number[] {
    const out: number[] = [];
    for (const msb of this.keys) {
      const base = msb << 16;
      for (const lsb of this.containers.get(msb)!.toArray()) {
        out.push((base | lsb) >>> 0);
      }
    }
    return out;
  }

  clone(): RoaringBitmap {
    return RoaringBitmap.or(this, new RoaringBitmap());
  }

  static and(a: RoaringBitmap, b: RoaringBitmap): RoaringBitmap {
    const result = new RoaringBitmap();
    let i = 0;
    let j = 0;
    while (i < a.keys.length && j < b.keys.length) {
      const ka = a.keys[i];
      const kb = b.keys[j];
      if (ka === kb) {
        const c = a.containers.get(ka)!.and(b.containers.get(kb)!);
        if (!c.isEmpty()) {
          result.containers.set(ka, c);
          result.keys.push(ka);
        }
        i++;
        j++;
      } else if (ka < kb) {
        i++;
      } else {
        j++;
      }
    }
    return result;
  }

  static or(a: RoaringBitmap, b: RoaringBitmap): RoaringBitmap {
    const result = new RoaringBitmap();
    let i = 0;
    let j = 0;
    while (i < a.keys.length && j < b.keys.length) {
      const ka = a.keys[i];
      const kb = b.keys[j];
      if (ka === kb) {
        result.containers.set(
          ka,
          a.containers.get(ka)!.or(b.containers.get(kb)!),
        );
        result.keys.push(ka);
        i++;
        j++;
      } else if (ka < kb) {
        result.containers.set(ka, a.containers.get(ka)!);
        result.keys.push(ka);
        i++;
      } else {
        result.containers.set(kb, b.containers.get(kb)!);
        result.keys.push(kb);
        j++;
      }
    }
    while (i < a.keys.length) {
      result.containers.set(a.keys[i], a.containers.get(a.keys[i])!);
      result.keys.push(a.keys[i]);
      i++;
    }
    while (j < b.keys.length) {
      result.containers.set(b.keys[j], b.containers.get(b.keys[j])!);
      result.keys.push(b.keys[j]);
      j++;
    }
    return result;
  }

  static andNot(a: RoaringBitmap, b: RoaringBitmap): RoaringBitmap {
    const result = new RoaringBitmap();
    let i = 0;
    let j = 0;
    while (i < a.keys.length) {
      const ka = a.keys[i];
      if (j < b.keys.length) {
        const kb = b.keys[j];
        if (ka === kb) {
          const c = a.containers.get(ka)!.andNot(b.containers.get(kb)!);
          if (!c.isEmpty()) {
            result.containers.set(ka, c);
            result.keys.push(ka);
          }
          i++;
          j++;
        } else if (ka < kb) {
          result.containers.set(ka, a.containers.get(ka)!);
          result.keys.push(ka);
          i++;
        } else {
          j++;
        }
      } else {
        result.containers.set(ka, a.containers.get(ka)!);
        result.keys.push(ka);
        i++;
      }
    }
    return result;
  }

  serialize(): Uint8Array {
    let size = 2;
    for (const msb of this.keys) {
      const c = this.containers.get(msb)!;
      size += 5;
      if (c.containerType === ContainerType.Array) {
        size += c.cardinality * 2;
      } else if (c.containerType === ContainerType.Bitmap) {
        size += 8192;
      } else {
        size += (c as RunContainer).numRuns * 4;
      }
    }

    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let offset = 0;

    view.setUint16(offset, this.keys.length, true);
    offset += 2;

    for (const msb of this.keys) {
      const c = this.containers.get(msb)!;
      view.setUint16(offset, msb, true);
      offset += 2;
      view.setUint8(offset, c.containerType);
      offset += 1;
      if (c.containerType === ContainerType.Run) {
        view.setUint16(offset, (c as RunContainer).numRuns, true);
      } else {
        view.setUint16(offset, c.cardinality, true);
      }
      offset += 2;
      offset += c.serialize(view, offset);
    }

    return new Uint8Array(buf);
  }

  static deserialize(data: Uint8Array): RoaringBitmap {
    const bm = new RoaringBitmap();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const count = view.getUint16(offset, true);
    offset += 2;

    for (let n = 0; n < count; n++) {
      const msb = view.getUint16(offset, true);
      offset += 2;
      const type = view.getUint8(offset);
      offset += 1;
      const meta = view.getUint16(offset, true);
      offset += 2;

      let container: Container;
      if (type === ContainerType.Array) {
        const arr = new Uint16Array(meta);
        for (let i = 0; i < meta; i++) {
          arr[i] = view.getUint16(offset, true);
          offset += 2;
        }
        container = new ArrayContainer(arr, meta);
      } else if (type === ContainerType.Bitmap) {
        const words = new Uint32Array(2048);
        for (let i = 0; i < 2048; i++) {
          words[i] = view.getUint32(offset, true);
          offset += 4;
        }
        container = new BitmapContainer(words, meta);
      } else {
        const runs = new Uint16Array(meta * 2);
        for (let i = 0; i < meta; i++) {
          runs[i * 2] = view.getUint16(offset, true);
          offset += 2;
          runs[i * 2 + 1] = view.getUint16(offset, true);
          offset += 2;
        }
        container = new RunContainer(runs, meta);
      }

      bm.containers.set(msb, container);
      bm.keys.push(msb);
    }

    return bm;
  }
}
