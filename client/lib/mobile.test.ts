import { afterEach, expect, test } from "vitest";
import {
  noteKeyboardActivity,
  resetModalFilterFocusForTests,
  shouldFocusModalFilter,
} from "./mobile.ts";

type PointerKind = "fine" | "coarse" | "none";

function mockPointer(primary: PointerKind): () => void {
  const original = globalThis.matchMedia;
  if (primary === "none") {
    delete (globalThis as { matchMedia?: typeof matchMedia }).matchMedia;
    return () => {
      globalThis.matchMedia = original;
    };
  }
  globalThis.matchMedia = ((query: string) => ({
    matches: query === "(pointer: fine)" ? primary === "fine" : false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as typeof globalThis.matchMedia;
  return () => {
    globalThis.matchMedia = original;
  };
}

function shortcut(init: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    isComposing: init.isComposing ?? false,
  } as KeyboardEvent;
}

afterEach(() => {
  resetModalFilterFocusForTests();
});

test("without matchMedia, modal filters focus (desktop default)", () => {
  const restore = mockPointer("none");
  try {
    expect(shouldFocusModalFilter()).toBe(true);
  } finally {
    restore();
  }
});

test("a fine primary pointer always focuses the modal filter", () => {
  const restore = mockPointer("fine");
  try {
    expect(shouldFocusModalFilter()).toBe(true);
  } finally {
    restore();
  }
});

test("a coarse pointer without a keyboard skips focus so a tap-open keeps the OSK recoverable", () => {
  const restore = mockPointer("coarse");
  try {
    expect(shouldFocusModalFilter()).toBe(false);
  } finally {
    restore();
  }
});

test("a coarse pointer still focuses after a keyboard shortcut (tablet + keyboard)", () => {
  const restore = mockPointer("coarse");
  try {
    noteKeyboardActivity(shortcut({ key: "/", metaKey: true }));
    expect(shouldFocusModalFilter()).toBe(true);
  } finally {
    restore();
  }
});

test("Ctrl and Alt chords also count as a keyboard-driven open", () => {
  const restore = mockPointer("coarse");
  try {
    noteKeyboardActivity(shortcut({ key: "k", ctrlKey: true }));
    expect(shouldFocusModalFilter()).toBe(true);
    resetModalFilterFocusForTests();
    noteKeyboardActivity(shortcut({ key: "p", altKey: true }));
    expect(shouldFocusModalFilter()).toBe(true);
  } finally {
    restore();
  }
});

test("plain typing on a coarse pointer does not enable modal autofocus", () => {
  const restore = mockPointer("coarse");
  try {
    noteKeyboardActivity(shortcut({ key: "a" }));
    expect(shouldFocusModalFilter()).toBe(false);
  } finally {
    restore();
  }
});

test("IME composition is ignored so a composing shortcut-like event does not stick", () => {
  const restore = mockPointer("coarse");
  try {
    noteKeyboardActivity(
      shortcut({ key: "/", metaKey: true, isComposing: true }),
    );
    expect(shouldFocusModalFilter()).toBe(false);
  } finally {
    restore();
  }
});

test("once a hardware shortcut is seen, later tap-opens on that session still focus", () => {
  const restore = mockPointer("coarse");
  try {
    noteKeyboardActivity(shortcut({ key: "/", metaKey: true }));
    expect(shouldFocusModalFilter()).toBe(true);
    // A later check with no new keydown still focuses: the session saw a
    // keyboard, so a tap-open should not force the user back to the editor.
    expect(shouldFocusModalFilter()).toBe(true);
  } finally {
    restore();
  }
});
