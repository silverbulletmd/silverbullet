import { syscall } from "./syscall.ts";

export function start(serverUrl: string, token: string, username: string) {
  return syscall("collab.start", serverUrl, token, username);
}

export function stop() {
  return syscall("collab.stop");
}

export function ping(clientId: string, currentPage: string) {
  return syscall("collab.ping", clientId, currentPage);
}
