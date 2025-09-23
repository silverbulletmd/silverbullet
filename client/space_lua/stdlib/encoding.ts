import { LuaBuiltinFunction, LuaTable } from "../runtime.ts";
import { base64Decode, base64Encode } from "../../../plug-api/lib/crypto.ts";

export const encodingApi = new LuaTable({
  base64Encode: new LuaBuiltinFunction(
    (_sf, s: string | Uint8Array): string => {
      return base64Encode(s);
    },
  ),
  base64Decode: new LuaBuiltinFunction((_sf, s: string): Uint8Array => {
    return base64Decode(s);
  }),
  utf8Encode: new LuaBuiltinFunction((_sf, s: string): Uint8Array => {
    return new TextEncoder().encode(s);
  }),
  utf8Decode: new LuaBuiltinFunction((_sf, data: Uint8Array): string => {
    return new TextDecoder().decode(data);
  }),
});
