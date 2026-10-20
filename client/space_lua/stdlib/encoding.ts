import { LuaBuiltinFunction, LuaTable } from "../runtime.ts";
import { base64Decode, base64Encode } from "../../../plug-api/lib/crypto.ts";

export const encodingApi = new LuaTable({
  base64Encode: new LuaBuiltinFunction({
    callback: (_sf, s: string | Uint8Array): string => {
      return base64Encode(s);
    },
    description: "Encodes a string or byte buffer as Base64.",
    parameters: [{ name: "data", type: "string|bytes" }],
    returns: [{ type: "string", description: "Base64-encoded data." }],
  }),
  base64Decode: new LuaBuiltinFunction({
    callback: (_sf, s: string): Uint8Array => {
      return base64Decode(s);
    },
    description: "Decodes a Base64 string into a byte buffer.",
    parameters: [{ name: "encoded", type: "string" }],
    returns: [{ type: "bytes", description: "Decoded bytes." }],
  }),
  utf8Encode: new LuaBuiltinFunction({
    callback: (_sf, s: string): Uint8Array => {
      return new TextEncoder().encode(s);
    },
    description: "Encodes a UTF-8 string into a byte buffer.",
    parameters: [{ name: "value", type: "string" }],
    returns: [{ type: "bytes", description: "UTF-8 encoded bytes." }],
  }),
  utf8Decode: new LuaBuiltinFunction({
    callback: (_sf, data: Uint8Array): string => {
      return new TextDecoder().decode(data);
    },
    description: "Decodes a UTF-8 byte buffer into a string.",
    parameters: [{ name: "data", type: "bytes" }],
    returns: [{ type: "string", description: "Decoded text." }],
  }),
  urlEncode: new LuaBuiltinFunction({
    callback: (_sf, s: string): string => {
      return encodeURIComponent(s);
    },
    description:
      "Percent-encodes a string as UTF-8, like JavaScript's encodeURIComponent.",
    parameters: [{ name: "value", type: "string" }],
    returns: [{ type: "string", description: "URL-encoded string." }],
  }),
  urlDecode: new LuaBuiltinFunction({
    callback: (_sf, s: string): string => {
      try {
        return decodeURIComponent(s);
      } catch (e) {
        if (e instanceof URIError) {
          return s;
        }
        throw e;
      }
    },
    description:
      "Decodes a percent-encoded string, like JavaScript's decodeURIComponent. Malformed input is returned unchanged.",
    parameters: [{ name: "encoded", type: "string" }],
    returns: [{ type: "string", description: "Decoded string." }],
  }),
});
