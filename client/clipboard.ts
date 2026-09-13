export async function copyToClipboard(data: string | Blob): Promise<void> {
  if (typeof data !== "string") {
    if (!navigator.clipboard?.write) {
      throw new Error(
        "Copying images and binary data requires HTTPS or localhost.",
      );
    }
    await navigator.clipboard.write([new ClipboardItem({ [data.type]: data })]);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(data);
    return;
  }
  const focused = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const field = document.createElement("textarea");
  field.value = data;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand("copy")) {
      throw new Error(
        "Could not copy automatically. Select the text and use your browser's Copy command.",
      );
    }
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
