// Drives the `#sb-boot-indicator` element in index.html, which covers the
// stretch of a cold boot where nothing else shows progress.

function indicator(): HTMLElement | null {
  return globalThis.document?.getElementById("sb-boot-indicator") ?? null;
}

export function setBootStatus(label: string): void {
  const labelEl = indicator()?.querySelector(".sb-boot-label");
  if (labelEl) labelEl.textContent = label;
}

export function hideBootIndicator(): void {
  indicator()?.remove();
}
