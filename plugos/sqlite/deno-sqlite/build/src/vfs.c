#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <sqlite3.h>
#include <pcg.h>
#include "debug.h"
#include "imports.h"

// SQLite VFS component.
// Based on demoVFS from SQLlite.
// https://www.sqlite.org/src/doc/trunk/src/test_demovfs.c

#define MAXPATHNAME 1024
#define JS_MAX_SAFE_INTEGER 9007199254740991

// When using this VFS, the sqlite3_file* handles that SQLite uses are
// actually pointers to instances of type DenoFile.
typedef struct DenoFile DenoFile;
struct DenoFile {
  sqlite3_file base;
  // Deno file resource id
  int rid;
};

static int denoClose(sqlite3_file *pFile) {
  DenoFile* p = (DenoFile*)pFile;
  js_close(p->rid);
  debug_printf("closing file (rid %i)\n", p->rid);
  return SQLITE_OK;
}

// Read data from a file.
static int denoRead(sqlite3_file *pFile, void *zBuf, int iAmt, sqlite_int64 iOfst) {
  DenoFile *p = (DenoFile*)pFile;

  int read_bytes = 0;

  if (iOfst <= JS_MAX_SAFE_INTEGER) {
    // Read bytes from buffer
    read_bytes = js_read(p->rid, (char*)zBuf, (double)iOfst, iAmt);
    debug_printf("attempt to read from file (rid %i, amount %i, offset %lli, read %i)\n",
      p->rid, iAmt, iOfst, read_bytes);
  } else {
    debug_printf("read offset %lli overflows JS_MAX_SAFE_INTEGER\n", iOfst);
  }

  // Zero memory if read was short
  if (read_bytes < iAmt)
    memset(&((char*)zBuf)[read_bytes], 0, iAmt-read_bytes);

  return read_bytes < iAmt ? SQLITE_IOERR_SHORT_READ : SQLITE_OK;
}

// Write data to a file.
static int denoWrite(sqlite3_file *pFile, const void *zBuf, int iAmt, sqlite_int64 iOfst) {
  DenoFile *p = (DenoFile*)pFile;

  int write_bytes = 0;

  if (iOfst <= JS_MAX_SAFE_INTEGER) {
    // Write bytes to buffer
    write_bytes = js_write(p->rid, (char*)zBuf, (double)iOfst, iAmt);
    debug_printf("attempt to write to file (rid %i, amount %i, offset %lli, written %i)\n",
      p->rid, iAmt, iOfst, write_bytes);
  } else {
    debug_printf("write offset %lli overflows JS_MAX_SAFE_INTEGER\n", iOfst);
  }

  return write_bytes == iAmt ? SQLITE_OK : SQLITE_IOERR_WRITE;
}

// Truncate file.
static int denoTruncate(sqlite3_file *pFile, sqlite_int64 size) {
  DenoFile *p = (DenoFile*)pFile;
  if (size <= JS_MAX_SAFE_INTEGER) {
    js_truncate(p->rid, (double)size);
    debug_printf("truncating file (rid %i, size: %lli)\n", p->rid, size);
    return SQLITE_OK;
  } else {
    debug_printf("truncate length %lli overflows JS_MAX_SAFE_INTEGER\n", size);
    return SQLITE_IOERR;
  }
}

// Deno provides no explicit sync for us, so we
// just have a no-op here.
// TODO(dyedgreen): Investigate if there is a better way
static int denoSync(sqlite3_file *pFile, int flags) {
  DenoFile *p = (DenoFile*)pFile;
  js_sync(p->rid);
  debug_printf("syncing file (rid %i)\n", p->rid);
  return SQLITE_OK;
}

// Write the size of the file in bytes to *pSize.
static int denoFileSize(sqlite3_file *pFile, sqlite_int64 *pSize) {
  DenoFile *p = (DenoFile*)pFile;
  *pSize = (sqlite_int64)js_size(p->rid);
  debug_printf("read file size: %lli (rid %i)\n", *pSize, p->rid);
  return SQLITE_OK;
}

// File locking
static int denoLock(sqlite3_file *pFile, int eLock) {
  DenoFile *p = (DenoFile*)pFile;
  switch (eLock) {
    case SQLITE_LOCK_NONE:
      // no op
      break;
    case SQLITE_LOCK_SHARED:
    case SQLITE_LOCK_RESERVED: // one WASM process <-> one open database
      js_lock(p->rid, 0);
      break;
    case SQLITE_LOCK_PENDING:
    case SQLITE_LOCK_EXCLUSIVE:
      js_lock(p->rid, 1);
      break;
  }
  return SQLITE_OK;
}

static int denoUnlock(sqlite3_file *pFile, int eLock) {
    DenoFile *p = (DenoFile*)pFile;
  switch (eLock) {
    case SQLITE_LOCK_NONE:
      // no op
      break;
    case SQLITE_LOCK_SHARED:
    case SQLITE_LOCK_RESERVED:
    case SQLITE_LOCK_PENDING:
    case SQLITE_LOCK_EXCLUSIVE:
      js_unlock(p->rid);
      break;
  }
  return SQLITE_OK;
}

static int denoCheckReservedLock(sqlite3_file *pFile, int *pResOut) {
  *pResOut = 0;
  return SQLITE_OK;
}

// No xFileControl() verbs are implemented by this VFS.
static int denoFileControl(sqlite3_file *pFile, int op, void *pArg) {
  return SQLITE_NOTFOUND;
}

// TODO(dyedgreen): Should we try to get these?
static int denoSectorSize(sqlite3_file *pFile) {
  return 0;
}
static int denoDeviceCharacteristics(sqlite3_file *pFile) {
  return 0;
}

// Open a file handle.
static int denoOpen(
  sqlite3_vfs *pVfs,              /* VFS */
  const char *zName,              /* File to open, or 0 for a temp file */
  sqlite3_file *pFile,            /* Pointer to DenoFile struct to populate */
  int flags,                      /* Input SQLITE_OPEN_XXX flags */
  int *pOutFlags                  /* Output SQLITE_OPEN_XXX flags (or NULL) */
) {
  static const sqlite3_io_methods denoio = {
    1,                            /* iVersion */
    denoClose,                    /* xClose */
    denoRead,                     /* xRead */
    denoWrite,                    /* xWrite */
    denoTruncate,                 /* xTruncate */
    denoSync,                     /* xSync */
    denoFileSize,                 /* xFileSize */
    denoLock,                     /* xLock */
    denoUnlock,                   /* xUnlock */
    denoCheckReservedLock,        /* xCheckReservedLock */
    denoFileControl,              /* xFileControl */
    denoSectorSize,               /* xSectorSize */
    denoDeviceCharacteristics     /* xDeviceCharacteristics */
  };

  DenoFile *p = (DenoFile*)pFile;
  p->base.pMethods = &denoio;

  // TODO(dyedgreen): The current approach is to raise
  // the permission error on the vfs.js side of things,
  // should the error be propagates through the wrapper
  // and be raised on the wrapper side of things?
  p->rid = js_open(zName, zName ? 0 : 1, flags);

  if (pOutFlags) {
    *pOutFlags = flags;
  }

  debug_printf("opened file (rid %i)\n", p->rid);
  debug_printf("file path name: '%s'\n", zName);
  return SQLITE_OK;
}

// Delete the file at the path.
static int denoDelete(sqlite3_vfs *pVfs, const char *zPath, int dirSync) {
  js_delete(zPath);
  return SQLITE_OK;
}

// All valid id files are accessible.
static int denoAccess(sqlite3_vfs *pVfs, const char *zPath, int flags, int *pResOut) {
  switch (flags) {
    case SQLITE_ACCESS_EXISTS:
      *pResOut = js_exists(zPath);
      break;
    default:
      *pResOut = js_access(zPath);
      break;
  }
  debug_printf("determining file access (path %s, access %i)\n", zPath, *pResOut);
  return SQLITE_OK;
}

// TODO(dyedgreen): Actually resolve the full path name
static int denoFullPathname(sqlite3_vfs *pVfs, const char *zPath, int nPathOut, char *zPathOut) {
  sqlite3_snprintf(nPathOut, zPathOut, "%s", zPath);
  debug_printf("requesting full path name for path: %s\n", zPath);
  return SQLITE_OK;
}

// We don't support shared objects
static void *denoDlOpen(sqlite3_vfs *pVfs, const char *zPath) {
  return 0;
}
static void denoDlError(sqlite3_vfs *pVfs, int nByte, char *zErrMsg) {
  sqlite3_snprintf(nByte, zErrMsg, "Loadable extensions are not supported");
  zErrMsg[nByte-1] = '\0';
}
static void (*denoDlSym(sqlite3_vfs *pVfs, void *pH, const char *z))(void) {
  return 0;
}
static void denoDlClose(sqlite3_vfs *pVfs, void *pHandle) {
  return;
}

// Generate pseudo-random data
static int denoRandomness(sqlite3_vfs *pVfs, int nByte, char *zByte) {
  pcg_bytes(zByte, nByte);
  return SQLITE_OK;
}

// TODO(dyedgreen): Can anything be done here?
static int denoSleep(sqlite3_vfs *pVfs, int nMicro) {
  return 0;
}

// Retrieve the current time
static int denoCurrentTime(sqlite3_vfs *pVfs, double *pTime) {
  *pTime = js_time() / 1000 / 86400.0 + 2440587.5;
  return SQLITE_OK;
}

// Implement localtime_r
struct tm* localtime_r(const time_t *time, struct tm *result) {
  debug_printf("running localtime_r");
  time_t shifted = *time - 60 * js_timezone();
  return gmtime_r(&shifted, result);
}

// This function returns a pointer to the VFS implemented in this file.
sqlite3_vfs *sqlite3_denovfs(void) {
  static sqlite3_vfs denovfs = {
    3,                            /* iVersion */
    sizeof(DenoFile),             /* szOsFile */
    MAXPATHNAME,                  /* mxPathname */
    0,                            /* pNext */
    "deno",                       /* zName */
    0,                            /* pAppData */
    denoOpen,                     /* xOpen */
    denoDelete,                   /* xDelete */
    denoAccess,                   /* xAccess */
    denoFullPathname,             /* xFullPathname */
    denoDlOpen,                   /* xDlOpen */
    denoDlError,                  /* xDlError */
    denoDlSym,                    /* xDlSym */
    denoDlClose,                  /* xDlClose */
    denoRandomness,               /* xRandomness */
    denoSleep,                    /* xSleep */
    denoCurrentTime,              /* xCurrentTime */
    0,                            /* xGetLastError */
    0,                            /* xCurrentTimeInt64 */
    0,                            /* xSetSystemCall */
    0,                            /* xGetSystemCall */
    0,                            /* xNextSystemCall */
  };
  return &denovfs;
}

int sqlite3_os_init(void) {
  debug_printf("running sqlite3_os_init\n");
  // Register VFS
  return sqlite3_vfs_register(sqlite3_denovfs(), 1);
}

int sqlite3_os_end(void) {
  return SQLITE_OK;
}
