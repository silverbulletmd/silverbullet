import type { Client } from "./client.ts";
import type { ServiceWorkerSourceMessage } from "./types/ui.ts";

export type SafetyEntry = {
  hash: string;
  size: number;
  ts: number;
  binary: boolean;
};

export function decodeSafetyText(data: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

export function formatSafetyLabel(entry: SafetyEntry): string {
  const label = `${new Date(entry.ts).toISOString()} · ${entry.size} bytes`;
  return entry.binary ? `${label} (binary)` : label;
}

const safetyListTimeoutMs = 3000;
const safetyContentTimeoutMs = 3000;

/** `undefined` return means the service worker didn't reply within `timeoutMs`. */
export function requestSafetyList(
  client: Client,
  timeoutMs = safetyListTimeoutMs,
): Promise<SafetyEntry[] | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (entries: SafetyEntry[] | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", listener);
      resolve(entries);
    };
    const listener = (event: MessageEvent) => {
      const message: ServiceWorkerSourceMessage = event.data;
      if (message.type === "safety-list") {
        finish(message.entries);
      }
    };
    const timeout = setTimeout(() => finish(undefined), timeoutMs);
    navigator.serviceWorker.addEventListener("message", listener);
    void client.postServiceWorkerMessage({ type: "list-safety" });
  });
}

/** `undefined` return means the service worker didn't reply within `timeoutMs`;
 * `null` means it replied but had no data for that hash. */
export function requestSafetyContent(
  client: Client,
  hash: string,
  timeoutMs = safetyContentTimeoutMs,
): Promise<Uint8Array | null | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (data: Uint8Array | null | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", listener);
      resolve(data);
    };
    const listener = (event: MessageEvent) => {
      const message: ServiceWorkerSourceMessage = event.data;
      if (message.type === "safety-content" && message.hash === hash) {
        finish(message.data);
      }
    };
    const timeout = setTimeout(() => finish(undefined), timeoutMs);
    navigator.serviceWorker.addEventListener("message", listener);
    void client.postServiceWorkerMessage({ type: "get-safety", hash });
  });
}
