declare global {
  function syscall(id: number, name: string, args: any[]): Promise<any>;
  var reqId: number;
}

// This needs to be global, because this will be shared with all other functions in the same environment (worker-like)
if (typeof self.reqId === "undefined") {
  self.reqId = 0;
}

export async function syscall(name: string, ...args: any[]): Promise<any> {
  self.reqId++;
  // console.log("Syscall", name, reqId);
  return await self.syscall(self.reqId, name, args);
}
