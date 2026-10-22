import { hashSHA1, hashSHA256 } from "../../../plug-api/lib/crypto.ts";
import { LuaBuiltinFunction, LuaTable } from "../runtime.ts";

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
  sha1: new LuaBuiltinFunction({
    callback: (_sf, s: string | Uint8Array): Promise<string> => {
      return hashSHA1(s);
    },
    description:
      "Computes the SHA-1 digest of a string or byte buffer, e.g. to match git object ids. Not for security.",
    parameters: [
      { name: "data", type: "string|bytes", description: "Data to hash." },
    ],
    returns: [{ type: "string", description: "Hexadecimal SHA-1 digest." }],
  }),
});
