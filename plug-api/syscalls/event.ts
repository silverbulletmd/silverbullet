import { syscall } from "../syscall.ts";

export function dispatchEvent(
  eventName: string,
  data: any,
  timeout?: number,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    let timeouter: any = -1;
    if (timeout) {
      timeouter = setTimeout(() => {
        console.log("Timeout!");
        reject("timeout");
      }, timeout);
    }
    syscall("event.dispatch", eventName, data)
      .then((r) => {
        if (timeouter !== -1) {
          clearTimeout(timeouter);
        }
        resolve(r);
      })
      .catch(reject);
  });
}

export function listEvents(): Promise<string[]> {
  return syscall("event.list");
}
