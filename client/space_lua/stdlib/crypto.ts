import { LuaBuiltinFunction, LuaTable } from "../runtime.ts";
import { hashSHA256 } from "../../../plug-api/lib/crypto.ts";

export const cryptoApi = new LuaTable({
  sha256: new LuaBuiltinFunction({
    callback: (_sf, s: string | Uint8Array): Promise<string> => {
      return hashSHA256(s);
    },
    description: "Computes the SHA-256 digest of a string or byte buffer.",
    parameters: [
      { name: "data", type: "string|bytes", description: "Data to hash." },
    ],
    returns: [{ type: "string", description: "Hexadecimal SHA-256 digest." }],
  }),
});
