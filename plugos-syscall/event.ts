import { syscall } from "./syscall";

export async function dispatch(
  eventName: string,
  data: any,
  timeout?: number
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    let timeOut = setTimeout(() => {
      console.log("Timeout!");
      reject("timeout");
    }, timeout);
    syscall("event.dispatch", eventName, data)
      .then((r) => {
        clearTimeout(timeOut);
        resolve(r);
      })
      .catch(reject);
  });
}
