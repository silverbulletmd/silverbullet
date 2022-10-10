import { flashNotification } from "../../syscall/silverbullet-syscall/editor.ts";

export async function replaceAsync(
  str: string,
  regex: RegExp,
  asyncFn: (match: string, ...args: any[]) => Promise<string>
) {
  const promises: Promise<string>[] = [];
  str.replace(regex, (match: string, ...args: any[]): string => {
    const promise = asyncFn(match, ...args);
    promises.push(promise);
    return "";
  });
  const data = await Promise.all(promises);
  return str.replace(regex, () => data.shift()!);
}

export function isServer() {
  return (
    typeof window === "undefined" || typeof window.document === "undefined"
  ); // if something defines window the same way as the browser, this will fail.
}

// this helps keep if's condition as positive
export function isBrowser() {
  return !isServer();
}

export async function notifyUser(message: string, type?: "info" | "error") {
  if (isBrowser()) {
    return flashNotification(message, type);
  }
  const log = type === "error" ? console.error : console.log;
  log(message); // we should end up sending the message to the user, users dont read logs.
  return;
}
