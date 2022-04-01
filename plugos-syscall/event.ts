import { syscall } from "./syscall";

export async function dispatch(eventName: string, data: any): Promise<void> {
  return syscall("event.dispatch", eventName, data);
}
