#ifndef IMPORTS_H
#define IMPORTS_H

// WASM imports specified in vfs.syms

extern void   js_print(const char*);
extern int    js_open(const char*, int, int);
extern void   js_close(int);
extern void   js_delete(const char*);
extern int    js_read(int, const char*, double, int);
extern int    js_write(int, const char*, double, int);
extern void   js_truncate(int, double);
extern void   js_sync(int);
extern double js_size(int);
extern void   js_lock(int, int);
extern void   js_unlock(int);
extern double js_time();
extern int    js_timezone();
extern int    js_exists(const char*);
extern int    js_access(const char*);

#endif // DEBUG_H
