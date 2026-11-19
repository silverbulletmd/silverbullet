// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { StarterGallery } from "./starter_gallery.tsx";

const kits = [
  { id: "personal", name: "Personal space", description: "Daily notes" },
  {
    id: "blank-space",
    name: "Blank space",
    description: "Nothing",
    previewUrl: "p/empty.png",
  },
];

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

async function show(showGit: boolean, onPick = vi.fn(), selectedId?: string) {
  await act(() => {
    render(h(StarterGallery, { kits, onPick, showGit, selectedId }), root);
  });
  return onPick;
}

const labels = () =>
  [...root.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));

test("renders one button per kit in order", async () => {
  await show(false);
  expect(labels()).toEqual(["Personal space", "Blank space"]);
  expect(root.querySelector("img")?.getAttribute("src")).toBe("p/empty.png");
});

test("Git card only with showGit", async () => {
  await show(true);
  expect(labels()).toEqual([
    "Personal space",
    "Blank space",
    "From a Git repository",
  ]);
  expect(root.textContent).toContain("Start from a Git repository");
});

test("clicking calls onPick with the choice", async () => {
  const onPick = await show(true);
  const buttons = root.querySelectorAll("button");
  await act(() => buttons[1].click());
  await act(() => buttons[2].click());
  expect(onPick.mock.calls).toEqual([
    [{ type: "kit", id: "blank-space" }],
    [{ type: "git" }],
  ]);
});

test("selectedId marks one card pressed; none without it", async () => {
  await show(true);
  expect(root.querySelectorAll("[aria-pressed]").length).toBe(0);
  await show(true, vi.fn(), "blank-space");
  const pressed = (b: Element) => b.getAttribute("aria-pressed");
  expect([...root.querySelectorAll("button")].map(pressed)).toEqual([
    "false",
    "true",
    "false",
  ]);
  await show(true, vi.fn(), "git");
  expect([...root.querySelectorAll("button")].map(pressed)).toEqual([
    "false",
    "false",
    "true",
  ]);
});

test("cards without a preview show an icon: file by default, the given one otherwise", async () => {
  await act(() => {
    render(
      h(StarterGallery, {
        kits: [
          { id: "a", name: "A", description: "a" },
          { id: "b", name: "B", description: "b", icon: "git-branch" },
          { id: "c", name: "C", description: "c", previewUrl: "p/c.png" },
        ],
        onPick: vi.fn(),
        showGit: true,
      }),
      root,
    );
  });
  const cards = [...root.querySelectorAll(".sb-starter-card")];
  const iconClass = (c: Element) =>
    c
      .querySelector(".sb-starter-preview [data-icon]")
      ?.getAttribute("data-icon");
  expect(iconClass(cards[0])).toBe("file");
  expect(iconClass(cards[1])).toBe("git-branch");
  expect(cards[2].querySelector("svg")).toBeNull();
  expect(iconClass(cards[3])).toBe("git-branch");
});

test("a kit icon can be any Lucide name", async () => {
  const { useFullIcons } = await import("./icons/test_icons.ts");
  useFullIcons();
  render(
    h(StarterGallery, {
      kits: [{ id: "x", name: "X", description: "d", icon: "rocket" }],
      onPick: () => {},
      showGit: false,
    }),
    root,
  );
  expect(root.querySelector("svg.lucide-rocket")).not.toBeNull();
});
