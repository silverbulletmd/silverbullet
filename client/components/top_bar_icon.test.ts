// @vitest-environment happy-dom
import { h, render } from "preact";
import { expect, test } from "vitest";
import { useFullIcons } from "../../plug-api/ui/icons/test_icons.ts";
import { TopBar } from "./top_bar.tsx";

function topBar(pageIcon?: string): HTMLElement {
  useFullIcons();
  const root = document.createElement("div");
  render(
    h(TopBar, {
      pageName: "Some Page",
      pageIcon,
      unsavedChanges: false,
      isOnline: true,
      isLoading: false,
      notifications: [],
      onRename: async () => {},
      onDismissNotification: () => {},
      actionButtons: [],
      readOnly: false,
    }),
    root,
  );
  return root;
}

test("a page icon from frontmatter with a deprecated name renders its Lucide replacement", () => {
  expect(
    topBar("md-home").querySelector(
      ".sb-page-decoration-icon svg.lucide-house",
    ),
  ).not.toBeNull();
});

test("a page without an icon renders no decoration icon", () => {
  expect(
    topBar(undefined).querySelector(".sb-page-decoration-icon"),
  ).toBeNull();
});
