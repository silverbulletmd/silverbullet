export function folderName(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

export function resolve(...paths: string[]) {
  const parts = paths.reduce((acc, path) => {
    return acc.concat(path.split("/"));
  }, [] as string[]);
  const resolvedParts = [];
  for (const part of parts) {
    if (part === "..") {
      resolvedParts.pop();
    } else if (part !== ".") {
      resolvedParts.push(part);
    }
  }
  const result = resolvedParts.join("/");
  if (result[0] === "/") {
    return result.substring(1);
  } else {
    return result;
  }
}
