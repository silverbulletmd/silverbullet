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
  private running = false;

  runInQueue(fn: () => Promise<any>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      if (!this.running) {
        this.run();
      }
    });
  }

  private async run(): Promise<void> {
    if (this.queue.length === 0) {
      this.running = false;
      return;
    }

    this.running = true;
    const { fn, resolve, reject } = this.queue.shift()!;

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }

    this.run(); // Continue processing the next promise in the queue
  }
}
