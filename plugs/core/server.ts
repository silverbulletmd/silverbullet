import { syscall } from "./lib/syscall";
export function test() {
  console.log("I'm running on the server!");
  return 5;
}
