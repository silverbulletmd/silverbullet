export class LockoutTimer {
  // A very simple, quick, inexact lockout timer
  // For each request isLocked() or updateBucketTime() must be called before addCount()
  // counts in buckets of countPeriodMs
  // each period starts with an empty bucket
  // suggest SB_LOCKOUT_TIME_MS=60000  SB_LOCKOUT_LIMIT=10
  bucketTime: number = 0;
  bucketCount: number = 0;
  bucketSize: number;
  limit: number;
  disabled: boolean;

  constructor(
    countPeriodMs: number,
    limit: number,
  ) {
    this.disabled = isNaN(countPeriodMs) || isNaN(limit) || countPeriodMs < 1 ||
      limit < 1;
    this.bucketSize = countPeriodMs;
    this.limit = limit;
  }

  updateBucketTime(): void {
    const currentBucketTime = Math.floor(Date.now() / this.bucketSize);
    if (this.bucketTime === currentBucketTime) {
      return;
    }
    // the bucket is too old - empty it
    this.bucketTime = currentBucketTime;
    this.bucketCount = 0;
  }

  isLocked(): boolean {
    if (this.disabled) {
      return false;
    }
    this.updateBucketTime();
    return this.bucketCount >= this.limit;
  }

  addCount(): void {
    // isLocked or updateBucketTime must be called first to keep bucketTime current
    this.bucketCount++;
  }
}
