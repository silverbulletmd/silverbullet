#include "pcg.h"

// Random number generator.
// Based on:
// *Really* minimal PCG32 code / (c) 2014 M.E. O'Neill / pcg-random.org
// Licensed under Apache License 2.0 (NO WARRANTY, etc. see website)

uint64_t state = 0x853c49e6748fea9bULL;
uint64_t inc   = 0xda3e39cb94b95bdbULL;

// Update seed of generator.
void pcg_seed(uint64_t seed) {
  state = seed;
}

// Generate random integer.
uint32_t pcg_rand() {
    uint64_t oldstate = state;
    // Advance internal state
    state = oldstate * 6364136223846793005ULL + (inc|1);
    // Calculate output function (XSH RR), uses old state for max ILP
    uint32_t xorshifted = ((oldstate >> 18u) ^ oldstate) >> 27u;
    uint32_t rot = oldstate >> 59u;
    return (xorshifted >> rot) | (xorshifted << ((-rot) & 31));
}

// Fill out buffer with size random bytes.
void pcg_bytes(char* out, int size) {
  // TODO: We can be more efficient by using all 4
  //       pieces of the random number returned.
  for (int i = 0; i < size; i ++) {
    out[i] = (char)pcg_rand();
  }
}
