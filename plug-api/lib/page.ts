export function validatePageName(name: string) {
  // Page can not be empty and not end with a file extension (e.g. "bla.md")
  if (name === "") {
    throw new Error("Page name can not be empty");
  }
  if (name.startsWith(".")) {
    throw new Error("Page name cannot start with a '.'");
  }
  if (name.includes("@")) {
    throw new Error("Page name cannot contain '@'");
  }
  if (name.includes("$")) {
    throw new Error("Page name cannot contain '$'");
  }
  if (/\.[a-zA-Z]+$/.test(name)) {
    throw new Error("Page name can not end with a file extension");
  }
}
