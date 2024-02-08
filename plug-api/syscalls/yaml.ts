import { syscall } from "../syscall.ts";

export function parse(
  text: string,
): Promise<any> {
  return syscall("yaml.parse", text);
}

export function stringify(
  obj: any,
): Promise<string> {
  return syscall("yaml.stringify", obj);
}
