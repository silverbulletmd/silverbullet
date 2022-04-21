import { syscall } from "./syscall";

export async function json(url: RequestInfo, init: RequestInit): Promise<any> {
  return syscall("fetch.json", url, init);
}

export async function text(
  url: RequestInfo,
  init: RequestInit = {}
): Promise<string> {
  return syscall("fetch.text", url, init);
}
