/**
 * Lower-cased, filesystem-safe version of a space name, used to derive its
 * default folder and URL prefix. Shared by the space manager (`SpaceForm`) and
 * the first-run setup wizard (`Wizard`) — both built from `client/spaces_ui` —
 * so both derive identical defaults.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
