import { syscall } from "../syscall.ts";

/**
 * Implements a very simple (string) key value store for the client.
 * Generally should only be used to set some client-specific states, such as preferences.
 */

export function set(key: string, value: any): Promise<void> {
  return syscall("clientStore.set", key, value);
}

export function get(key: string): Promise<any> {
  return syscall("clientStore.get", key);
}

export function del(key: string): Promise<void> {
  return syscall("clientStore.delete", key);
}
