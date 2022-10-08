export function safeRun(fn: () => Promise<void>) {
  fn().catch((e: any) => {
    console.error("Caught error", e.message);

    // throw e;
  });
}
