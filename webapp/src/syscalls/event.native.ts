import { SyscallContext } from "../plugins/runtime";

export default {
  "event.publish": async (ctx: SyscallContext, name: string, data: any) => {
    await ctx.cartridge.dispatchEvent(name, data);
  },
};
