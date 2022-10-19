#include <stdlib.h>
#include <sqlite3.h>
#include <pcg.h>
#include "debug.h"

#define EXPORT(name) __attribute__((used)) __attribute__((export_name (#name))) name
#define ERROR_VAL -1

#define BIG_INT_TYPE 6
#define JS_MAX_SAFE_INTEGER 9007199254740991
#define JS_MIN_SAFE_INTEGER (-JS_MAX_SAFE_INTEGER)

// Status returned by last instruction
int last_status = SQLITE_OK;
// Database handle for this instance
sqlite3* database = NULL;

// Return length of string pointed to by str.
int EXPORT(str_len) (const char* str) {
  int len;
  for (len = 0; str[len] != '\0'; len ++);
  return len;
}

// Seed the random number generator. We pass a double, to
// get as many bytes from the JS number as possible.
void EXPORT(seed_rng) (double seed) {
  pcg_seed((uint64_t)seed);
}

// Return last status encountered.
int EXPORT(get_status) () {
  return last_status;
}

// Initialize the database and return the status.
int EXPORT(open) (const char* filename, int flags) {
  // Return error is database is already open
  if (database) {
    last_status = SQLITE_MISUSE;
    return last_status;
  }

  // Open SQLite db connection
  last_status = sqlite3_open_v2(filename, &database, flags, NULL);
  if (last_status != SQLITE_OK) {
    debug_printf("failed to open database with status %i\n", last_status);
    return last_status;
  }
  debug_printf("opened database at path '%s'\n", filename);
  return last_status;
}

// Attempt to close the database connection.
int EXPORT(close) () {
  last_status = sqlite3_close(database);
  if (last_status == SQLITE_OK) {
    database = NULL;
    debug_printf("closed database");
  } else {
    debug_printf("failed to close database with status %i\n", last_status);
  }
  return last_status;
}

// Return most recent SQLite error as a string
const char* EXPORT(get_sqlite_error_str) () {
  if (!database)
    return "No open database.";
  return sqlite3_errmsg(database);
}

// Wraps sqlite3_prepare. Returns statement id.
sqlite3_stmt* EXPORT(prepare) (const char* sql) {
  // Prepare sqlite statement
  sqlite3_stmt* stmt;
  last_status = sqlite3_prepare_v2(database, sql, -1, &stmt, NULL);
  debug_printf("prepared sql statement (status %i)\n", last_status);

  if (last_status != SQLITE_OK)
    return NULL;
  return stmt;
}

// Destruct the given statement/ transaction. This will destruct the SQLite
// statement and free up it's transaction slot. Regardless of returned
// status, the statement id will be freed up.
int EXPORT(finalize) (sqlite3_stmt* stmt) {
  last_status = sqlite3_finalize(stmt);
  debug_printf("finalized statement (status %i)\n", last_status);
  return last_status;
}

// Reset a given statement so it can be re-used.
int EXPORT(reset) (sqlite3_stmt* stmt) {
  last_status = sqlite3_reset(stmt);
  debug_printf("reset statement (status %i)\n", last_status);
  return last_status;
}

// Resets all bound parameter values for this statement.
int EXPORT(clear_bindings) (sqlite3_stmt* stmt) {
  last_status = sqlite3_clear_bindings(stmt);
  debug_printf("clear bindings (status %i)\n", last_status);
  return last_status;
}

// Execute multiple statements from a single string. This ignores any result
// rows.
int EXPORT(exec) (const char* sql) {
  last_status = sqlite3_exec(database, sql, NULL, NULL, NULL);
  debug_printf("ran exec (status %i)\n", last_status);
  return last_status;
}

// Wrappers for bind statements, these return the status directly
int EXPORT(bind_int) (sqlite3_stmt* stmt, int idx, double value) {
  // we use double to pass in the value, as JS does not support 64 bit integers,
  // but handles floats and we can contain a 32 bit in in a 64 bit float, so there
  // should be no loss.
  last_status = sqlite3_bind_int64(stmt, idx, (sqlite3_int64)value);
  debug_printf("binding int %lli (status %i)\n", (sqlite3_int64)value, last_status);
  return last_status;
}

int EXPORT(bind_double) (sqlite3_stmt* stmt, int idx, double value) {
  last_status = sqlite3_bind_double(stmt, idx, value);
  debug_printf("binding double %f (status %i)\n", value, last_status);
  return last_status;
}

int EXPORT(bind_text) (sqlite3_stmt* stmt, int idx, const char* value) {
  // SQLite retrains the string until we execute the statement, but any strings
  // passed in from JS are freed when the function returns. Thus we need to mark
  // is as transient.
  last_status = sqlite3_bind_text(stmt, idx, value, -1, SQLITE_TRANSIENT);
  debug_printf("binding text '%s' (status %i)\n", value, last_status);
  return last_status;
}

int EXPORT(bind_blob) (sqlite3_stmt* stmt, int idx, void* value, int size) {
  // SQLite retrains the pointer until we execute the statement, but any pointers
  // passed in from JS are freed when the function returns. Thus we need to mark
  // is as transient.
  last_status = sqlite3_bind_blob(stmt, idx, value, size, SQLITE_TRANSIENT);
  debug_printf("binding blob '%s' (status %i)\n", value, last_status);
  return last_status;
}

int EXPORT(bind_big_int) (sqlite3_stmt* stmt, int idx, int sign, uint32_t high, uint32_t low) {
  // Bind a big integer within the 64 bit integer range by passing it as two 32
  // bit integers. The integers are assumed to be positive, and a sign is passed
  // separately.
  sqlite3_int64 int_val = ((sqlite3_int64)low + ((sqlite3_int64)high << 32)) * (sqlite3_int64)sign;
  debug_printf("binding big_int %lld", int_val);
  last_status = sqlite3_bind_int64(stmt, idx, int_val);
  return last_status;
}

int EXPORT(bind_null) (sqlite3_stmt* stmt, int idx) {
  last_status = sqlite3_bind_null(stmt, idx);
  debug_printf("binding null (status %i)\n", last_status);
  return last_status;
}

// Determine parameter index for named parameters
int EXPORT(bind_parameter_index) (sqlite3_stmt* stmt, const char* name) {
  int index = sqlite3_bind_parameter_index(stmt, name);
  if (index == 0) {
    debug_printf("parameter '%s' does not exist", name);
    // Normalize SQLite returning 0 for not found to ERROR_VAL
    return ERROR_VAL;
  }
  debug_printf("obtained parameter index (param '%s', index %i)\n", name, index);
  return index;
}

// Wraps running statements, this returns the status directly
int EXPORT(step) (sqlite3_stmt* stmt) {
  last_status = sqlite3_step(stmt);
  debug_printf("stepping statement (status %i)\n", last_status);
  return last_status;
}

// Count columns returned by statement.
int EXPORT(column_count) (sqlite3_stmt* stmt) {
  return sqlite3_column_count(stmt);
}

// Determine type of column. Returns SQLITE column types.
int EXPORT(column_type) (sqlite3_stmt* stmt, int col) {
  int type = sqlite3_column_type(stmt, col);
  if (type == SQLITE_INTEGER) {
    // handle integers that exceed JS_MAX_SAFE_INTEGER
    sqlite3_int64 col_val = sqlite3_column_int64(stmt, col);
    if (col_val > JS_MAX_SAFE_INTEGER || col_val < JS_MIN_SAFE_INTEGER) {
      debug_printf("detected big integer: %lld\n", col_val);
      return BIG_INT_TYPE;
    }
  }
  return type;
}

// Wrap result returning functions.
double EXPORT(column_int) (sqlite3_stmt* stmt, int col) {
  return (double)sqlite3_column_int64(stmt, col);
}

double EXPORT(column_double) (sqlite3_stmt* stmt, int col) {
  return sqlite3_column_double(stmt, col);
}

const char* EXPORT(column_text) (sqlite3_stmt* stmt, int col) {
  return (const char*)sqlite3_column_text(stmt, col);
}

const void* EXPORT(column_blob) (sqlite3_stmt* stmt, int col) {
  return sqlite3_column_blob(stmt, col);
}

int EXPORT(column_bytes) (sqlite3_stmt* stmt, int col) {
  return sqlite3_column_bytes(stmt, col);
}

const char* EXPORT(column_name) (sqlite3_stmt* stmt, int col) {
  return sqlite3_column_name(stmt, col);
}

const char* EXPORT(column_origin_name) (sqlite3_stmt* stmt, int col) {
  return sqlite3_column_origin_name(stmt, col);
}

const char* EXPORT(column_table_name) (sqlite3_stmt* stmt, int col) {
  return sqlite3_column_table_name(stmt, col);
}

double EXPORT(last_insert_rowid) () {
  return (double)sqlite3_last_insert_rowid(database);
}

double EXPORT(changes) () {
  return (double)sqlite3_changes(database);
}

double EXPORT(total_changes) () {
  return (double)sqlite3_total_changes(database);
}
