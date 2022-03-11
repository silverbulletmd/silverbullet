declare global {
  function syscall(id: number, name: string, args: any[]): Promise<any>;
}

export async function syscall(name: string, ...args: any[]): Promise<any> {
  let reqId = Math.floor(Math.random() * 1000000);
  // console.log("Syscall", name, reqId);
  return await self.syscall(reqId, name, args);
  // return new Promise((resolve, reject) => {
  //   self.dispatchEvent(
  //     new CustomEvent("syscall", {
  //       detail: {
  //         id: reqId,
  //         name: name,
  //         args: args,
  //         callback: resolve,
  //       },
  //     })
  //   );
  // });
}
