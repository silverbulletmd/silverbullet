import { LuaBuiltinFunction, LuaTable } from "../runtime.ts";
import { base64Decode, base64Encode } from "../../../plug-api/lib/crypto.ts";

export const encodingApi = new LuaTable({
  base64Encode: new LuaBuiltinFunction(
    (_sf, s: string | Uint8Array): string => {
      return base64Encode(s);
    },
    {
      kind: "builtin",
      description: "Encodes a string or byte buffer as Base64.",
      parameters: [{ name: "data", type: "string|bytes" }],
      returns: [{ type: "string", description: "Base64-encoded data." }],
    },
  ),
  base64Decode: new LuaBuiltinFunction(
    (_sf, s: string): Uint8Array => {
      return base64Decode(s);
    },
    {
      kind: "builtin",
      description: "Decodes a Base64 string into a byte buffer.",
      parameters: [{ name: "encoded", type: "string" }],
      returns: [{ type: "bytes", description: "Decoded bytes." }],
    },
  ),
  utf8Encode: new LuaBuiltinFunction(
    (_sf, s: string): Uint8Array => {
      return new TextEncoder().encode(s);
    },
    {
      kind: "builtin",
      description: "Encodes a UTF-8 string into a byte buffer.",
      parameters: [{ name: "value", type: "string" }],
      returns: [{ type: "bytes", description: "UTF-8 encoded bytes." }],
    },
  ),
  utf8Decode: new LuaBuiltinFunction(
    (_sf, data: Uint8Array): string => {
      return new TextDecoder().decode(data);
    },
    {
      kind: "builtin",
      description: "Decodes a UTF-8 byte buffer into a string.",
      parameters: [{ name: "data", type: "bytes" }],
      returns: [{ type: "string", description: "Decoded text." }],
    },
  ),
});
