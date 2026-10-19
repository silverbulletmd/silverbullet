/** Built-in library and repository pages are indexed too, but aren't the user's to count or fix. */
export const isUserPage = (name: string): boolean =>
  !name.startsWith("Library/") && !name.startsWith("Repositories/");
