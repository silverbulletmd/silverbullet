#ifndef DEBUG_H
#define DEBUG_H
#ifdef DEBUG_BUILD

#include <stdlib.h>
#include <printf.h>
#include "imports.h"

// Print debug messages
#define debug_printf(...) { \
                            char* __debug_msg = malloc(2048); \
                            if (!__debug_msg) { \
                              js_print("ERROR: No memory for debug message.\n"); \
                            } else { \
                              size_t __used = snprintf(__debug_msg, 2048, "DEBUG: %s:%d:%s(): ", __FILE__, __LINE__, __func__); \
                              snprintf(&__debug_msg[__used], 2048 - __used, __VA_ARGS__); \
                              js_print(__debug_msg); \
                              free(__debug_msg); \
                            } \
                          }

#else // DEBUG_BUILD

#define debug_printf(...)

#endif // DEBUG_BUILD
#endif // DEBUG_H
