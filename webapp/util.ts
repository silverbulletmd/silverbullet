export function countWords(str: string): number {
  const matches = str.match(/[\w\d\'-]+/gi);
  return matches ? matches.length : 0;
}

export function readingTime(wordCount: number): number {
  // 225 is average word reading speed for adults
  return Math.ceil(wordCount / 225);
}

export function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}

export function isMacLike() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

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
