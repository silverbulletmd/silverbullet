export function folderName(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function relativePath(sourceFolder: string, targetPath: string) {
  if (sourceFolder === "") {
    return targetPath;
  }
  const sourceParts = sourceFolder.split("/");
  const targetParts = targetPath.split("/");
  if (sourceFolder === targetPath) {
    return `../${targetParts[targetParts.length - 1]}`;
  }
  while (sourceParts[0] === targetParts[0] && sourceParts.length > 0) {
    sourceParts.shift();
    targetParts.shift();
  }
  return (
    "../".repeat(sourceParts.length) + targetParts.join("/")
  );
}

export function toRelativePath(
  currentPath: string,
  absolutePath: string,
): string {
  return relativePath(folderName(currentPath), absolutePath);
}

export function toAbsolutePath(
  currentPath: string,
  relativePath: string,
): string {
  if (relativePath.startsWith("!")) {
    // Nothing to do for federation links
    return relativePath;
  }
  return resolve(folderName(currentPath), relativePath);
}

function resolve(...paths: string[]) {
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
