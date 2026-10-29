/** Content pages counted in space statistics. */
export const isUserPage = (name: string): boolean =>
  !name.startsWith("Library/") && !name.startsWith("Repositories/");
