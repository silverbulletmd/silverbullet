// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { Panel } from "./panel.tsx";

/** A client whose theme can be switched by hand, like `SpaceTheme.show()` does. */
function themedClient() {
  const listeners = new Set<() => void>();
  const spaceTheme = {
    message: {
      scheme: "light",
      page: "Library/Paper/Day",
      css: "<style>html{--root-color:#111}</style>",
    },
    onChange(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const switchTo = (page: string, scheme: string, css: string) => {
    spaceTheme.message = { scheme, page, css };
    for (const fn of listeners) fn();
  };
  return {
    client: { spaceTheme, clientSystem: {} } as unknown as Client,
    switchTo,
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
});

test("an open iframe panel is sent the new theme's CSS when the theme changes", async () => {
  const { client, switchTo, listenerCount } = themedClient();
  await act(() => {
    render(
      h(Panel, {
        config: { html: "<p>graph</p>", mode: 1 },
        editor: client,
        slot: "rhs",
      }),
      document.body,
    );
  });
  const iframe = document.querySelector("iframe")!;
  await new Promise((resolve) => iframe.addEventListener("load", resolve));
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");

  switchTo(
    "Library/Paper/Night",
    "dark",
    "<style>html{--root-color:#eee}</style>",
  );

  expect(post).toHaveBeenCalledWith({
    type: "theme",
    scheme: "dark",
    page: "Library/Paper/Night",
    css: "<style>html{--root-color:#eee}</style>",
  });

  await act(() => render(null, document.body));
  expect(listenerCount()).toBe(0);
});
