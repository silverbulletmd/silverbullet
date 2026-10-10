/**
 * Widgets, `${…}` expressions, queries and transclusions render
 * asynchronously after the page text is in the editor. This module tracks
 * those renders so a caller (e.g. one taking a screenshot) can wait until the
 * current page has finished rendering.
 */

const pendingRenders = new Set<Promise<unknown>>();

/**
 * Elements that mark rendering still in progress: the placeholder shown
 * before the client can render widgets at all, navigator views still loading
 * their content, and page slots whose views have not all resolved.
 */
export const renderBusySelector =
  '.sb-loading-widget, [aria-busy="true"], .sb-page-slot:not([data-settled="1"])';

/** Registers an in-flight render; returns the same promise. */
export function trackRender<T>(render: Promise<T>): Promise<T> {
  pendingRenders.add(render);
  const done = () => {
    pendingRenders.delete(render);
  };
  render.then(done, done);
  return render;
}

export type AwaitRenderOptions = {
  /** Resolves once the client can render widgets (before that it shows placeholders). */
  ready?: Promise<unknown>;
  /** Whether the rendered page still shows elements that are loading. */
  isBusy?: () => boolean;
  nextFrame?: () => Promise<void>;
  timeoutMs: number;
};

// Two consecutive idle frames: a render finishing can schedule a CodeMirror
// measure pass that brings further widgets into the viewport one frame later.
const idleFramesRequired = 2;

/**
 * Resolves `true` once no tracked render is in flight and the page has stayed
 * idle for a couple of frames, or `false` if that did not happen within
 * `timeoutMs`.
 */
export async function awaitRenderSettled(
  options: AwaitRenderOptions,
): Promise<boolean> {
  const nextFrame = options.nextFrame ?? animationFrame;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, options.timeoutMs);
  });

  try {
    if (options.ready) {
      await Promise.race([options.ready, timeout]);
    }
    let idleFrames = 0;
    while (!expired) {
      if (pendingRenders.size > 0) {
        idleFrames = 0;
        await Promise.race([Promise.allSettled([...pendingRenders]), timeout]);
        continue;
      }
      await nextFrame();
      if (pendingRenders.size === 0 && !options.isBusy?.()) {
        idleFrames++;
        if (idleFrames >= idleFramesRequired) {
          return true;
        }
      } else {
        idleFrames = 0;
      }
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Background tabs and headless windows throttle requestAnimationFrame, so a
// short timer stands in for a frame that never comes.
function animationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 100);
  });
}
