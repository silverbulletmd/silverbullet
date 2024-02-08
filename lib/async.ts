export function throttle(func: () => void, limit: number) {
  let timer: any = null;
  return function () {
    if (!timer) {
      timer = setTimeout(() => {
        func();
        timer = null;
      }, limit);
    }
  };
}

// race for promises returns first promise that resolves
export function race<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    for (const p of promises) {
      p.then(resolve, reject);
    }
  });
}

export function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) =>
    setTimeout(() => {
      reject(new Error("timeout"));
    }, ms)
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PromiseQueue {
  private queue: {
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }[] = [];
  private processing = false;

  runInQueue(fn: () => Promise<any>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      if (!this.processing) {
        this.process();
      }
    });
  }

  private async process(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const { fn, resolve, reject } = this.queue.shift()!;

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }

    this.process(); // Continue processing the next promise in the queue
  }
}

export async function batchRequests<I, O>(
  values: I[],
  fn: (batch: I[]) => Promise<O[]>,
  batchSize: number,
): Promise<O[]> {
  const results: O[] = [];
  // Split values into batches of batchSize
  const batches: I[][] = [];
  for (let i = 0; i < values.length; i += batchSize) {
    batches.push(values.slice(i, i + batchSize));
  }
  // Run fn on them in parallel
  const batchResults = await Promise.all(batches.map(fn));
  // Flatten the results
  for (const batchResult of batchResults) {
    if (Array.isArray(batchResult)) { // If fn returns an array, collect them
      results.push(...batchResult);
    }
  }
  return results;
}

/**
 * Runs a function safely by catching any errors and logging them to the console.
 * @param fn - The function to run.
 */
export function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}
