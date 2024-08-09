import { syscall } from "../syscall.ts";

/**
 * Exposes the SilverBullet event bus.
 * @module
 */

/**
 * Triggers an event on the SilverBullet event bus.
 * This can be used to implement an RPC-style system too, because event handlers can return values,
 * which are then accumulated in an array and returned to the caller.
 * @param eventName the name of the event to trigger
 * @param data payload to send with the event
 * @param timeout optional timeout in milliseconds to wait for a response
 * @returns an array of responses from the event handlers (if any)
 */
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
      .then((r: any) => {
        if (timeouter !== -1) {
          clearTimeout(timeouter);
        }
        resolve(r);
      })
      .catch(reject);
  });
}

/**
 * List all events currently registered (listened to) on the SilverBullet event bus.
 * @returns an array of event names
 */
export function listEvents(): Promise<string[]> {
  return syscall("event.list");
}
