import jwt, { Algorithm } from "jsonwebtoken";
import { SysCallMapping } from "../system";

export function jwtSyscalls(): SysCallMapping {
  return {
    "jwt.jwt": (
      ctx,
      hexSecret: string,
      id: string,
      algorithm: Algorithm,
      expiry: string,
      audience: string
    ): string => {
      return jwt.sign({}, Buffer.from(hexSecret, "hex"), {
        keyid: id,
        algorithm: algorithm,
        expiresIn: expiry,
        audience: audience,
      });
    },
  };
}
