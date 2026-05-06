/**
 * Most Common Values (MCV) list for join selectivity estimation.
 * Tracks the Top-K most frequent values in a column.
 */
const DEFAULT_MCV_CAPACITY = 128;

export interface MCVConfig {
  capacity?: number;
}

export type MCVEntry = {
  value: string;
  count: number;
};

export class MCVList {
  private counts: Map<string, number>;
  private remainderCount: number;
  private _trackedTotal: number;
  public readonly capacity: number;

  constructor(config?: MCVConfig) {
    this.capacity = config?.capacity ?? DEFAULT_MCV_CAPACITY;
    this.counts = new Map();
    this.remainderCount = 0;
    this._trackedTotal = 0;
  }

  insert(value: string): void {
    const existing = this.counts.get(value);
    if (existing !== undefined) {
      this.counts.set(value, existing + 1);
      this._trackedTotal++;
      return;
    }

    if (this.counts.size < this.capacity) {
      this.counts.set(value, 1);
      this._trackedTotal++;
      return;
    }

    let minKey: string | undefined;
    let minCount = Infinity;
    for (const [k, c] of this.counts) {
      if (c < minCount) {
        minCount = c;
        minKey = k;
      }
    }

    this.remainderCount++;

    if (
      minKey !== undefined &&
      minCount <= 1 &&
      this.remainderCount > this.capacity
    ) {
      this.counts.delete(minKey);
      this._trackedTotal -= minCount;
      this.remainderCount += minCount;
      this.counts.set(value, 1);
      this._trackedTotal++;
      this.remainderCount--;
    }
  }

  setDirect(value: string, count: number): void {
    if (count <= 0) {
      const existing = this.counts.get(value);
      if (existing !== undefined) {
        this._trackedTotal -= existing;
        this.counts.delete(value);
      }
      return;
    }
    const existing = this.counts.get(value);
    if (existing !== undefined) {
      this._trackedTotal += count - existing;
      this.counts.set(value, count);
    } else if (this.counts.size < this.capacity) {
      this.counts.set(value, count);
      this._trackedTotal += count;
    } else {
      let minKey: string | undefined;
      let minCount = Infinity;
      for (const [k, c] of this.counts) {
        if (c < minCount) {
          minCount = c;
          minKey = k;
        }
      }
      if (minKey !== undefined && count > minCount) {
        this._trackedTotal -= minCount;
        this.remainderCount += minCount;
        this.counts.delete(minKey);
        this.counts.set(value, count);
        this._trackedTotal += count;
      } else {
        this.remainderCount += count;
      }
    }
  }

  delete(value: string): void {
    const existing = this.counts.get(value);
    if (existing !== undefined) {
      if (existing <= 1) {
        this.counts.delete(value);
        this._trackedTotal--;
      } else {
        this.counts.set(value, existing - 1);
        this._trackedTotal--;
      }
      return;
    }
    if (this.remainderCount > 0) {
      this.remainderCount--;
    }
  }

  merge(other: MCVList): void {
    for (const [value, count] of other.counts) {
      const existing = this.counts.get(value);
      if (existing !== undefined) {
        this.counts.set(value, existing + count);
        this._trackedTotal += count;
      } else if (this.counts.size < this.capacity) {
        this.counts.set(value, count);
        this._trackedTotal += count;
      } else {
        let minKey: string | undefined;
        let minCount = Infinity;
        for (const [k, c] of this.counts) {
          if (c < minCount) {
            minCount = c;
            minKey = k;
          }
        }
        if (minKey !== undefined && count > minCount) {
          this._trackedTotal -= minCount;
          this.remainderCount += minCount;
          this.counts.delete(minKey);
          this.counts.set(value, count);
          this._trackedTotal += count;
        } else {
          this.remainderCount += count;
        }
      }
    }
    this.remainderCount += other.remainderCount;
  }

  subtract(other: MCVList): void {
    for (const [value, count] of other.counts) {
      const existing = this.counts.get(value);
      if (existing !== undefined) {
        const newCount = existing - count;
        if (newCount <= 0) {
          this._trackedTotal -= existing;
          this.counts.delete(value);
        } else {
          this._trackedTotal -= count;
          this.counts.set(value, newCount);
        }
      } else {
        this.remainderCount = Math.max(0, this.remainderCount - count);
      }
    }
    this.remainderCount = Math.max(
      0,
      this.remainderCount - other.remainderCount,
    );
  }

  totalCount(): number {
    return this._trackedTotal + this.remainderCount;
  }

  trackedSize(): number {
    return this.counts.size;
  }

  trackedRowCount(): number {
    return this._trackedTotal;
  }

  entries(): MCVEntry[] {
    const result: MCVEntry[] = [];
    for (const [value, count] of this.counts) {
      result.push({ value, count });
    }
    result.sort((a, b) => b.count - a.count);
    return result;
  }

  forEachEntry(fn: (value: string, count: number) => void): void {
    for (const [value, count] of this.counts) {
      fn(value, count);
    }
  }

  getCount(value: string): number {
    return this.counts.get(value) ?? 0;
  }

  clear(): void {
    this.counts.clear();
    this.remainderCount = 0;
    this._trackedTotal = 0;
  }

  serialize(): string {
    const entries: [string, number][] = [];
    for (const [k, v] of this.counts) {
      entries.push([k, v]);
    }
    return JSON.stringify({
      c: this.capacity,
      e: entries,
      r: this.remainderCount,
    });
  }

  static deserialize(serialized: string): MCVList {
    const obj = JSON.parse(serialized);
    const mcv = new MCVList({ capacity: obj.c ?? DEFAULT_MCV_CAPACITY });
    let total = 0;
    for (const [k, v] of obj.e ?? []) {
      mcv.counts.set(k, v);
      total += v;
    }
    mcv._trackedTotal = total;
    mcv.remainderCount = obj.r ?? 0;
    return mcv;
  }

  static estimateMatchFraction(
    leftMcv: MCVList | undefined,
    rightMcv: MCVList | undefined,
    leftRows: number,
    rightRows: number,
    leftNdv: number,
    rightNdv: number,
  ): { matchedLeftFraction: number; avgRightRowsPerKey: number } {
    if (
      !leftMcv ||
      !rightMcv ||
      leftMcv.trackedSize() === 0 ||
      rightMcv.trackedSize() === 0
    ) {
      const matchedLeftFraction =
        leftNdv > 0 ? Math.min(1, rightNdv / leftNdv) : 1;
      const avgRightRowsPerKey =
        rightNdv > 0 ? Math.max(1, rightRows / rightNdv) : 1;
      return { matchedLeftFraction, avgRightRowsPerKey };
    }

    const leftTracked = leftMcv.trackedRowCount();
    const rightTracked = rightMcv.trackedRowCount();

    const leftUntrackedNdv = Math.max(1, leftNdv - leftMcv.trackedSize());
    const leftUntrackedRows = Math.max(0, leftRows - leftTracked);
    const leftAvgPerUntracked =
      leftUntrackedNdv > 0 ? leftUntrackedRows / leftUntrackedNdv : 0;

    const rightUntrackedNdv = Math.max(1, rightNdv - rightMcv.trackedSize());
    const rightUntrackedRows = Math.max(0, rightRows - rightTracked);
    const rightAvgPerUntracked =
      rightUntrackedNdv > 0 ? rightUntrackedRows / rightUntrackedNdv : 0;

    let matchedLeftRows = 0;
    let matchedOutputRows = 0;

    rightMcv.forEachEntry((value, rCount) => {
      const leftCount = leftMcv.getCount(value);
      if (leftCount > 0) {
        matchedLeftRows += leftCount;
        matchedOutputRows += leftCount * rCount;
      } else {
        matchedLeftRows += leftAvgPerUntracked;
        matchedOutputRows += leftAvgPerUntracked * rCount;
      }
    });

    leftMcv.forEachEntry((value, lCount) => {
      const rightCount = rightMcv.getCount(value);
      if (rightCount > 0) {
        return;
      }
      const matchProb = Math.min(1, rightUntrackedNdv / leftUntrackedNdv);
      matchedLeftRows += lCount * matchProb;
      matchedOutputRows += lCount * matchProb * rightAvgPerUntracked;
    });

    const remainderMatchFrac = Math.min(
      1,
      rightUntrackedNdv / leftUntrackedNdv,
    );
    matchedLeftRows += leftUntrackedRows * remainderMatchFrac;
    matchedOutputRows +=
      leftUntrackedRows * remainderMatchFrac * rightAvgPerUntracked;

    const matchedLeftFraction =
      leftRows > 0 ? Math.min(1, matchedLeftRows / leftRows) : 0;
    const avgRightRowsPerKey =
      matchedLeftRows > 0
        ? Math.max(1, matchedOutputRows / matchedLeftRows)
        : 1;

    return { matchedLeftFraction, avgRightRowsPerKey };
  }

  topKeys(k: number): string[] {
    const entries: { value: string; count: number }[] = [];
    this.forEachEntry((value, count) => {
      entries.push({ value, count });
    });
    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, k).map((e) => e.value);
  }
}
