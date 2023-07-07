export function isValidPageName(name: string): boolean {
  // Page can not be empty and not end with a file extension (e.g. "bla.md")
  return name !== "" && !name.startsWith(".") && !/\.[a-zA-Z]+$/.test(name);
}
