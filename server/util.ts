export function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}
