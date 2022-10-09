import { syscall } from "./syscall.ts";

export function set(key: string, value: any): Promise<void> {
  return syscall("clientStore.set", key, value);
}

export function get(key: string): Promise<any> {
  return syscall("clientStore.get", key);
}

export function del(key: string): Promise<void> {
  return syscall("clientStore.delete", key);
}
