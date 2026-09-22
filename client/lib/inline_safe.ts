export function isInlineSafeContentType(contentType: string): boolean {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct === "image/svg+xml") {
    return false;
  }
  return (
    ct.startsWith("image/") ||
    ct === "application/pdf" ||
    ct.startsWith("video/") ||
    ct.startsWith("audio/")
  );
}

export function isInlineFileContentType(contentType: string): boolean {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return (
    isInlineSafeContentType(contentType) ||
    ct === "text/html" ||
    ct === "text/css" ||
    ct === "text/javascript" ||
    ct === "application/javascript"
  );
}
