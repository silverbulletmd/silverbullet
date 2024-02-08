import { create, getNumericDate, verify } from "djwt";
import type { KvPrimitives } from "$lib/data/kv_primitives.ts";

const jwtSecretKey = "jwtSecretKey";

export class JWTIssuer {
  private key!: CryptoKey;

  constructor(readonly kv: KvPrimitives) {
  }

  // authString is only used to compare hashes to see if the auth has changed
  async init(authString: string) {
    const [secret] = await this.kv.batchGet([[jwtSecretKey]]);
    if (!secret) {
      console.log("Generating new JWT secret key");
      return this.generateNewKey();
    } else {
      this.key = await crypto.subtle.importKey(
        "raw",
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
    const newAuthHash = await this.hashSHA256(authString);
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
      key: [jwtSecretKey],
      value: await crypto.subtle.exportKey("raw", this.key),
    }]);
  }

  createJWT(
    payload: Record<string, unknown>,
    expirySeconds: number,
  ): Promise<string> {
    return create({ alg: "HS512", typ: "JWT" }, {
      ...payload,
      exp: getNumericDate(expirySeconds),
    }, this.key);
  }

  verifyAndDecodeJWT(jwt: string): Promise<Record<string, unknown>> {
    return verify(jwt, this.key);
  }

  async hashSHA256(message: string): Promise<string> {
    // Transform the string into an ArrayBuffer
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    // Generate the hash
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);

    // Transform the hash into a hex string
    return Array.from(new Uint8Array(hashBuffer)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
  }
}
