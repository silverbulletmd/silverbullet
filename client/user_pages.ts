import { isToolPage } from "@silverbulletmd/silverbullet/lib/tool_pages";

/** Content pages counted in space statistics. */
export const isUserPage = (name: string): boolean => !isToolPage(name);
