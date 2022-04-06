import { syscall } from "./syscall";

export async function set(key: string, value: any): Promise<void> {
  return syscall("clientStore.set", key, value);
}

export async function get(key: string): Promise<any> {
  return syscall("clientStore.get", key);
}

export async function del(key: string): Promise<void> {
  return syscall("clientStore.delete", key);
}
