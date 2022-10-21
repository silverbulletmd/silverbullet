#ifndef PCG_H
#define PCG_H

#include <stdint.h>

// Seed the random number generator
void pcg_seed(uint64_t seed);

// Get random numbers and random bits
uint32_t pcg_rand();
void     pcg_bytes(char* out, int size);

#endif // PCG_H
