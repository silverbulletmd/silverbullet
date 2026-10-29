// Pure naming helpers for libraries and repositories

export const REPOSITORY_PAGE_PREFIX = "Repositories/";
export const STD_REPOSITORY = "Repositories/Std";
/** Shipped with SilverBullet: they update, but deleting one brings the shipped version back. */
export const BUNDLED_REPOSITORIES = new Set([
  STD_REPOSITORY,
  "Repositories/SilverBulletMD",
]);

export function suggestRepoNameFromUri(uri: string): string {
  const parts = uri.split(":");
  let name = parts[parts.length - 1];
  const strip = [".md", "/REPO", "/main", "/blob", "/silverbullet-libraries"];
  for (const s of strip) {
    if (name.endsWith(s)) name = name.slice(0, -s.length);
  }
  name = name.replace(/@.+$/, "");
  const segs = name.split("/");
  return segs[segs.length - 1] || name;
}
