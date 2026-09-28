import { type EditorView, tooltips } from "@codemirror/view";
import { isMobileDevice, noteSoftKeyboardVisible } from "./mobile.ts";

/**
 * Tracks the part of the layout that is actually visible above an on-screen
 * keyboard, and pins `#sb-root` to it via `--sb-viewport-top` and
 * `--sb-viewport-height`.
 *
 * Chromium reports the keyboard through the VirtualKeyboard API once
 * `overlaysContent` is set; `interactive-widget=resizes-content` alone
 * shrinks the page but gives no way to tell a collapsed keyboard from an
 * open one. WebKit only shrinks the visual viewport, and on iOS 26 also
 * scrolls the document (despite `overflow: hidden`) to reveal the caret,
 * which pushes the top bar off-screen; that scroll is undone here.
 */
export type KeyboardViewportState = {
  /** Height of the layout hidden behind the keyboard, in CSS pixels. */
  keyboardInset: number;
  /** Height of the visible area `#sb-root` is pinned to. */
  visibleHeight: number;
  /**
   * A physical keypress was seen while no on-screen keyboard was up. Cleared
   * again as soon as an on-screen keyboard appears.
   */
  hardwareKeyboard: boolean;
};

/** Below this inset there is no keyboard, only rounding or a thin accessory row. */
export const KEYBOARD_PRESENT_INSET = 40;
const SOFT_KEYBOARD_INSET = 150;

type VirtualKeyboard = EventTarget & {
  overlaysContent: boolean;
  boundingRect: DOMRect;
};

let state: KeyboardViewportState = {
  keyboardInset: 0,
  visibleHeight: 0,
  hardwareKeyboard: false,
};
const listeners = new Set<(state: KeyboardViewportState) => void>();
let installed = false;

export function keyboardViewportState(): KeyboardViewportState {
  return state;
}

export function subscribeKeyboardViewport(
  listener: (state: KeyboardViewportState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function virtualKeyboard(): VirtualKeyboard | undefined {
  return (navigator as { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
}

export type ViewportInput = {
  innerHeight: number;
  layoutHeight: number;
  visualViewport?: { height: number; offsetTop: number; scale: number };
  /** Set when the VirtualKeyboard API overlays the keyboard on the page. */
  virtualKeyboardHeight?: number;
};

export function measureViewport(input: ViewportInput): {
  top: number;
  height: number;
  inset: number;
} {
  if (input.virtualKeyboardHeight !== undefined) {
    const inset = input.virtualKeyboardHeight;
    return { top: 0, height: input.innerHeight - inset, inset };
  }
  const vv = input.visualViewport;
  // Pinch zoom also shrinks the visual viewport; that is not a keyboard.
  if (!vv || Math.abs(vv.scale - 1) > 0.01) {
    return { top: 0, height: input.layoutHeight, inset: 0 };
  }
  // `innerHeight` shrinks with the keyboard on iOS 26 but not on iOS 27;
  // `clientHeight` is the stable layout height on both.
  const inset = Math.max(0, input.layoutHeight - vv.offsetTop - vv.height);
  return { top: vv.offsetTop, height: vv.height, inset };
}

function measure() {
  const vk = virtualKeyboard();
  return measureViewport({
    innerHeight: globalThis.innerHeight,
    layoutHeight: document.documentElement.clientHeight,
    visualViewport: globalThis.visualViewport ?? undefined,
    virtualKeyboardHeight: vk?.overlaysContent
      ? vk.boundingRect.height
      : undefined,
  });
}

function update() {
  if (globalThis.scrollY !== 0) {
    globalThis.scrollTo(0, 0);
  }
  const { top, height, inset } = measure();
  const root = document.documentElement.style;
  root.setProperty("--sb-viewport-top", `${top}px`);
  root.setProperty("--sb-viewport-height", `${height}px`);

  const hardwareKeyboard =
    inset > SOFT_KEYBOARD_INSET ? false : state.hardwareKeyboard;
  setState({ keyboardInset: inset, visibleHeight: height, hardwareKeyboard });
}

function setState(next: KeyboardViewportState) {
  if (
    next.keyboardInset === state.keyboardInset &&
    next.visibleHeight === state.visibleHeight &&
    next.hardwareKeyboard === state.hardwareKeyboard
  ) {
    return;
  }
  state = next;
  noteSoftKeyboardVisible(next.keyboardInset > SOFT_KEYBOARD_INSET);
  for (const listener of listeners) listener(state);
}

function onKeyDown(ev: KeyboardEvent) {
  // On-screen keyboards on Android report "Unidentified"/"Process" (keyCode
  // 229); iOS reports real keys, but only while its keyboard is visible.
  if (ev.isComposing || ev.key === "Unidentified" || ev.key === "Process") {
    return;
  }
  if (state.hardwareKeyboard || measure().inset >= KEYBOARD_PRESENT_INSET) {
    return;
  }
  setState({ ...state, hardwareKeyboard: true });
}

export function installKeyboardViewport() {
  if (installed || !isMobileDevice()) return;
  installed = true;

  const vk = virtualKeyboard();
  if (vk) vk.overlaysContent = true;

  const schedule = () => {
    update();
    // WebKit settles the final visual viewport a frame after the event.
    requestAnimationFrame(update);
  };
  globalThis.visualViewport?.addEventListener("resize", schedule);
  globalThis.visualViewport?.addEventListener("scroll", schedule);
  globalThis.addEventListener("resize", schedule);
  globalThis.addEventListener("scroll", schedule);
  vk?.addEventListener("geometrychange", schedule);
  document.addEventListener("keydown", onKeyDown, true);

  document.documentElement.classList.add("sb-viewport-tracked");
  update();
}

/**
 * CodeMirror sizes tooltips (e.g. the completion list) against the whole
 * window, which on iOS still extends behind the on-screen keyboard. Once the
 * viewport is tracked, the editor's own scroll area is the visible space.
 */
export const keyboardAwareTooltips = tooltips({
  tooltipSpace: (view: EditorView) => {
    const window = {
      top: 0,
      left: 0,
      right: globalThis.innerWidth,
      bottom: globalThis.innerHeight,
    };
    if (!installed) return window;
    return {
      ...window,
      bottom: Math.min(
        window.bottom,
        view.scrollDOM.getBoundingClientRect().bottom,
      ),
    };
  },
});
