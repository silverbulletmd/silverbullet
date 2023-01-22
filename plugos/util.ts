export function safeRun(fn: () => Promise<void>) {
  fn().catch((e: any) => {
    console.error("Caught error", e.message);

    // throw e;
  });
}

export function urlToPathname(url: URL) {
  // For Windows, remove prefix /
  return url.pathname.replace(/^\/(\w:)/, "$1");
}
