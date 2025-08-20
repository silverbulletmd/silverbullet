import { create, getNumericDate, verify } from "djwt";
import type { KvPrimitives } from "../lib/data/kv_primitives.ts";

import type { KvKey } from "../type/datastore.ts";
import { hashSHA256 } from "../lib/crypto.ts";

const jwtSecretKey: KvKey = ["jwtSecretKey"];

export class JWTIssuer {
  private key!: CryptoKey;

  constructor(readonly kv: KvPrimitives) {
  }

  // authString is only used to compare hashes to see if the auth has changed
  async init(authString: string) {
    const [secret] = await this.kv.batchGet([jwtSecretKey]);
    if (!secret) {
      console.log("Generating new JWT secret key");
      return this.generateNewKey();
    } else {
      this.key = await crypto.subtle.importKey(
        "jwk",
        secret,
        { name: "HMAC", hash: "SHA-512" },
        true,
        ["sign", "verify"],
      );
    }

    // Check if the authentication has changed since last run
    const [currentAuthHash] = await this.kv.batchGet([[
      "authHash",
    ]]);
    const newAuthHash = await hashSHA256(authString);
    if (currentAuthHash && currentAuthHash !== newAuthHash) {
      console.log(
        "Authentication has changed since last run, so invalidating all existing tokens",
      );
      // It has, so we need to generate a new key to invalidate all existing tokens
      await this.generateNewKey();
    }
    if (currentAuthHash !== newAuthHash) {
      // Persist new auth hash
      await this.kv.batchSet([{
        key: ["authHash"],
        value: newAuthHash,
      }]);
    }
  }

  async generateNewKey() {
    this.key = await crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-512" },
      true,
      ["sign", "verify"],
    );
    await this.kv.batchSet([{
      key: jwtSecretKey,
      value: await crypto.subtle.exportKey("jwk", this.key),
    }]);
  }

  createJWT(
    payload: Record<string, unknown>,
    expirySeconds?: number,
  ): Promise<string> {
    const jwtPayload = { ...payload };
    if (expirySeconds) {
      jwtPayload.exp = getNumericDate(expirySeconds);
    }
    return create({ alg: "HS512", typ: "JWT" }, jwtPayload, this.key);
  }

  verifyAndDecodeJWT(jwt: string): Promise<Record<string, unknown>> {
    return verify(jwt, this.key);
  }
}
