export function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}
