declare global {
  function syscall(name: string, ...args: any[]): Promise<any>;
}

// This is the case when running tests only, so giving it a dummy syscall function
if (typeof self === "undefined") {
  // @ts-ignore: test
  // deno-lint-ignore no-global-assign
  self = {
    syscall: () => {
      throw new Error("Not implemented here");
    },
  };
}

export const syscall = globalThis.syscall;
