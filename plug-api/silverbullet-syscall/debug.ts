import { syscall } from "./syscall.ts";

export function resetClient() {
  return syscall("debug.resetClient");
}
