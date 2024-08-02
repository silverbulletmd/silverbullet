export function wildcardPathToRegex(pattern: string): RegExp {
  // Escape special characters in the pattern except for the wildcard "*"
  const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  // Replace the wildcard "*" with ".*" to match any character sequence
  const regexPattern = escapedPattern.replace(/\*/g, ".*");

  // Create a new regular expression with the converted pattern
  return new RegExp(`^${regexPattern}(\\.md)?$`);
}

export function federatedPathToLocalPath(path: string): string {
  return path.split("/").slice(1).join("/");
}
