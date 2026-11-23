import { isLibraryPage } from "@silverbulletmd/silverbullet/lib/library_pages";

/** Content pages counted in space statistics. */
export const isUserPage = (name: string): boolean => !isLibraryPage(name);
