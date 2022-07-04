export function niceDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
