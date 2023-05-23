import { syscall } from "./syscall.ts";

export function set(key: string, value: any): Promise<void> {
  return syscall("store.set", key, value);
}

export function get(key: string): Promise<any> {
  return syscall("store.get", key);
}

export function del(key: string): Promise<void> {
  return syscall("store.delete", key);
}
