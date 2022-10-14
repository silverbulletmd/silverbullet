export function niceDate(d: Date): string {
  function pad(n: number) {
    let s = String(n);
    if (s.length === 1) {
      s = "0" + s;
    }
    return s;
  }

  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
