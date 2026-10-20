import { expect, test } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { DeviceCode } from "../auth/device_flow.ts";
import { DeviceCodeModal } from "./basic_modals.tsx";

const SB_DEVICE = "http://localhost:3292/public/.auth/device";

function render(code: Partial<DeviceCode> = {}): string {
  return renderToString(
    h(DeviceCodeModal, {
      code: {
        userCode: "ABCD-1234",
        verificationUri: SB_DEVICE,
        expiresIn: 300,
        ...code,
      },
      onCancel: () => {},
    }),
  );
}

const deviceUrlSpan = (url: string) =>
  `<span class="sb-device-url">${url}</span>`;

test("device code modal wraps the URL and styles Open like a button", () => {
  const html = render();
  expect(html).toContain(deviceUrlSpan(SB_DEVICE));
  expect(html).toMatch(/<a [^>]*class="sb-button"[^>]*>Open<\/a>/);
  expect(html).toContain('rel="noopener"');
  expect(html).not.toContain("style=");
});

test("with a prefilled link the modal asks to check the code, not enter it", () => {
  const complete = `${SB_DEVICE}?user_code=ABCD-1234`;
  const html = render({ verificationUriComplete: complete });
  expect(html).not.toContain("enter this code");
  expect(html).toContain("check that it shows this code");
  expect(html).toContain(`href="${complete}"`);
  // The bare URL stays visible, for approving on another device
  expect(html).toContain(deviceUrlSpan(SB_DEVICE));
});

test("without a prefilled link the modal asks to enter the code", () => {
  const html = render({ verificationUri: "https://github.com/login/device" });
  expect(html).toContain("enter this code");
});
