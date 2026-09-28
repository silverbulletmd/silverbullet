import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";
import { CaptureView } from "./CaptureView.tsx";

test("capture view preserves raw fields and offers its available actions", () => {
  const html = renderToString(
    h(CaptureView, {
      draft: {
        id: "capture-1",
        receivedAt: 1,
        title: "Shared title",
        text: "https://example.test in text",
        url: "",
        files: [
          {
            handle: "file-1",
            name: "picture.png",
            type: "image/png",
            size: 123,
          },
        ],
      },
      pendingCount: 2,
      actions: [
        {
          id: "quick-note",
          name: "Save as Quick Note",
          description: "Create an Inbox page",
        },
      ],
      loadingActions: false,
      onChange() {},
      onRun() {},
      onDiscard() {},
      onClose() {},
      onNext() {},
    }),
  );
  expect(html).toContain("Shared title");
  expect(html).toContain("https://example.test in text");
  expect(html).toContain("picture.png");
  expect(html).toContain("2 pending captures");
  expect(html).toContain("Save as Quick Note");
});
