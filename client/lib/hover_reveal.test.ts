// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { HOVER_REVEALED_CLASS, installHoverReveal } from "./hover_reveal.ts";

describe("installHoverReveal: the innermost widget's ⋯ under the mouse", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.innerHTML = "";
  });

  const setup = () => {
    document.body.innerHTML = `
      <div class="sb-lua-directive-block" id="outer">
        <div><div class="sb-widget-menu-bar"><button id="menu"></button></div>
        <div class="content"><p id="text">x</p>
          <div class="sb-lua-directive-block" id="inner"><p id="innerText">y</p>
            <div><div class="sb-widget-menu-bar"><button></button></div></div>
            <div class="sb-lua-directive-block" id="bare"><p id="bareText">z</p></div>
          </div>
        </div></div>
      </div>
      <p id="page">page</p>`;
    uninstall = installHoverReveal(document);
    const el = (id: string) => document.getElementById(id)!;
    const move = (id: string, pointerType = "mouse") =>
      el(id).dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerType }),
      );
    const revealed = () =>
      [...document.querySelectorAll(`.${HOVER_REVEALED_CLASS}`)].map(
        (e) => e.id,
      );
    return { el, move, revealed };
  };

  test("marks the innermost host under the mouse at once", () => {
    const { move, revealed } = setup();
    move("text");
    expect(revealed()).toEqual(["outer"]);
    // A nested widget is a host of its own
    move("innerText");
    expect(revealed()).toEqual(["inner"]);
    // One without a ⋯ of its own (a form's input) counts as its parent
    move("bareText");
    expect(revealed()).toEqual(["inner"]);
    // The ⋯ itself is part of its host
    move("menu");
    expect(revealed()).toEqual(["outer"]);
  });

  test("leaving the host hides it at once; touch never reveals", () => {
    const { move, revealed } = setup();
    move("text");
    move("page");
    expect(revealed()).toEqual([]);
    move("text", "touch");
    expect(revealed()).toEqual([]);
  });

  test("pointing where an outer widget's hidden ⋯ sits reveals that widget, not the row under it", () => {
    document.body.innerHTML = `
      <div class="sb-lua-directive-block" id="widget">
        <div><div class="sb-widget-menu-bar" id="bar"><button></button></div>
        <div class="content">
          <div class="sb-in-menu-owner" id="row"><span id="aside">a</span>
            <span class="sb-in-menu-root"><button></button></span></div>
        </div></div>
      </div>`;
    uninstall = installHoverReveal(document);
    document.getElementById("bar")!.getBoundingClientRect = () =>
      ({ left: 100, right: 130, top: 0, bottom: 26 }) as DOMRect;
    const moveTo = (x: number, y: number) =>
      document.getElementById("aside")!.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
        }),
      );
    moveTo(110, 10);
    expect(document.getElementById("widget")!.className).toContain(
      HOVER_REVEALED_CLASS,
    );
    // Elsewhere on the row, the row's own ⋯
    moveTo(50, 10);
    expect(document.getElementById("row")!.className).toContain(
      HOVER_REVEALED_CLASS,
    );
  });
});
