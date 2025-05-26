export function removeUrlPrefix(url: string, prefix?: string): string {
  if (!prefix || prefix === "") return url;

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const parsedUrl = new URL(url);
    if (parsedUrl.pathname.startsWith(prefix)) {
      parsedUrl.pathname = parsedUrl.pathname.substring(
        prefix.length,
      );
      return parsedUrl.href;
    } else {
      return url;
    }
  } else if (url.startsWith(prefix)) {
    return url.substring(prefix.length);
  } else {
    return url;
  }
}

export function applyUrlPrefix<T extends (string | URL)>(
  url: T,
  prefix?: string,
): T {
  if (!prefix || prefix === "") return url;

  if (typeof url === "string") {
    const urlString = url as string;

    if (urlString.startsWith("http://") || urlString.startsWith("https://")) {
      return applyUrlPrefix(new URL(urlString), prefix).href as T;
    } else if (urlString.startsWith("/")) {
      return (prefix + urlString) as T;
    } else {
      return url; //return page-relative paths as-is
    }
  } else if (url.protocol === "http:" || url.protocol === "https:") {
    const urlObj = new URL(url);
    urlObj.pathname = prefix + urlObj.pathname;
    return urlObj as T;
  } else {
    return url;
  }
}
