export function utcDateString(mtime: number): string {
  return new Date(mtime).toUTCString();
}

export function authCookieName(host: string) {
  return `auth_${host.replaceAll(/\W/g, "_")}`;
}
