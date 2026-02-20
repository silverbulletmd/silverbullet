// PRNG based on xoshiro256** for Space Lua

export class LuaPRNG {
  private state: BigUint64Array;

  constructor() {
    this.state = new BigUint64Array(4);
    this.autoSeed();
  }

  private rotl(x: bigint, k: number): bigint {
    k = k & 63;
    return ((x << BigInt(k)) | (x >> BigInt(64 - k))) & 0xFFFFFFFFFFFFFFFFn;
  }

  private nextrand(): bigint {
    const s = this.state;
    const s0 = s[0];
    const s1 = s[1];
    const s2 = s[2];
    const s3 = s[3];

    const res = this.rotl((s1 * 5n) & 0xFFFFFFFFFFFFFFFFn, 7) * 9n &
      0xFFFFFFFFFFFFFFFFn;

    const t = (s1 << 17n) & 0xFFFFFFFFFFFFFFFFn;
    s[2] = s2 ^ s0;
    s[3] = s3 ^ s1;
    s[1] = s1 ^ s[2];
    s[0] = s0 ^ s[3];
    s[2] = s[2] ^ t;
    s[3] = this.rotl(s[3], 45);

    return res;
  }

  public setSeed(seed1: bigint, seed2: bigint = 0n): [bigint, bigint] {
    const MASK = 0xFFFFFFFFFFFFFFFFn;
    const s = this.state;

    const sm64 = (x: bigint): bigint => {
      x = (x ^ (x >> 30n)) * 0xBF58476D1CE4E5B9n & MASK;
      x = (x ^ (x >> 27n)) * 0x94D049BB133111EBn & MASK;
      return (x ^ (x >> 31n)) & MASK;
    };

    s[0] = sm64(seed1 & MASK);
    s[1] = sm64((seed1 & MASK) | 0xFFn);
    s[2] = sm64(seed2 & MASK);
    s[3] = sm64(0n);

    for (let i = 0; i < 16; i++) {
      this.nextrand();
    }

    return [seed1, seed2];
  }

  private autoSeed(): [bigint, bigint] {
    const t = BigInt(Date.now());
    const entropy = BigInt(Math.floor(performance.now() * 1000));
    return this.setSeed(t, entropy);
  }

  private project(ran: bigint, n: bigint): bigint {
    if (n === 0n) return 0n;

    let lim = n;
    lim |= lim >> 1n;
    lim |= lim >> 2n;
    lim |= lim >> 4n;
    lim |= lim >> 8n;
    lim |= lim >> 16n;
    lim |= lim >> 32n;

    while (true) {
      ran &= lim;
      if (ran <= n) return ran;
      ran = this.nextrand();
    }
  }

  // `random()` yields float in [0, 1)
  // `random(0)` yields raw 64-bit signed integer (all bits random)
  // `random(n)` yields integer in [1, n]
  // `random(m, n)` yields integer in [m, n]
  public random(arg1?: number, arg2?: number): number | bigint {
    const rv = this.nextrand();

    if (arg1 === undefined) {
      // Top 53 bits for full double precision
      return Number(rv >> 11n) * (1.0 / 9007199254740992.0);
    }

    if (!isFinite(arg1) || !Number.isInteger(arg1)) {
      throw new Error(
        "bad argument #1 to 'random' (number has no integer representation)",
      );
    }

    if (arg2 === undefined) {
      if (arg1 === 0) {
        // Raw 64-bit as signed bigint
        const signed = rv > 0x7FFFFFFFFFFFFFFFn
          ? rv - 0x10000000000000000n
          : rv;
        return signed;
      }
      if (arg1 < 1) {
        throw new Error("bad argument #1 to 'random' (interval is empty)");
      }
      return Number(this.project(rv, BigInt(arg1) - 1n) + 1n);
    }

    if (!isFinite(arg2) || !Number.isInteger(arg2)) {
      throw new Error(
        "bad argument #2 to 'random' (number has no integer representation)",
      );
    }
    if (arg2 < arg1) {
      throw new Error("bad argument #2 to 'random' (interval is empty)");
    }
    return Number(this.project(rv, BigInt(arg2) - BigInt(arg1)) + BigInt(arg1));
  }

  // Returns [seed1, seed2]
  public randomseed(arg1?: number, arg2?: number): [bigint, bigint] {
    if (arg1 === undefined) {
      return this.autoSeed();
    }
    if (!isFinite(arg1) || !Number.isInteger(arg1)) {
      throw new Error(
        "bad argument #1 to 'randomseed' (number has no integer representation)",
      );
    }
    if (arg2 !== undefined && (!isFinite(arg2) || !Number.isInteger(arg2))) {
      throw new Error(
        "bad argument #2 to 'randomseed' (number has no integer representation)",
      );
    }
    const s1 = BigInt(Math.trunc(arg1));
    const s2 = arg2 !== undefined ? BigInt(Math.trunc(arg2)) : 0n;
    return this.setSeed(s1, s2);
  }
}
