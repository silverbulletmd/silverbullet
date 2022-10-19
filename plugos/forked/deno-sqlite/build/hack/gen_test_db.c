#include <stdio.h>
#include <stdlib.h>
#include <sqlite3.h>

#define TRUE 1
#define FALSE 0

#define TEST_DB_FILE "2GB_test.db"

#define SQL_CREATE_TBL "CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)"
#define SQL_INSERT_VAL "INSERT INTO test (value) VALUES (?)"

#define VAL_LEN 65536
#define VAL_NUM 45000

void rand_str(char *dest, size_t length) {
  char charset[] = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  while (length --> 0) {
    size_t index = (double) rand() / RAND_MAX * (sizeof charset - 1);
    *dest++ = charset[index];
  }
  *dest = '\0';
}

int execute_query(sqlite3* db, char* query) {
  sqlite3_stmt* stmt_create;
  if (sqlite3_prepare_v2(db, query, -1, &stmt_create, NULL) != SQLITE_OK) {
    printf("Failed to prepare query statement: %s\n", sqlite3_errmsg(db));
    return FALSE;
  }
  if (sqlite3_step(stmt_create) != SQLITE_DONE) {
    printf("Failed to run query statement: %s\n", sqlite3_errmsg(db));
    return FALSE;
  }
  sqlite3_finalize(stmt_create);
  return TRUE;
}

int main(int argc, char* argv[]) {
  sqlite3* db;
  if (sqlite3_open(TEST_DB_FILE, &db) != SQLITE_OK) {
    printf("Failed to open database: %s\n", sqlite3_errmsg(db));
    return 1;
  }

  // create database table
  sqlite3_stmt* stmt_create;
  if (sqlite3_prepare_v2(db, SQL_CREATE_TBL, -1, &stmt_create, NULL) != SQLITE_OK) {
    printf("Failed to prepare create table statement: %s\n", sqlite3_errmsg(db));
    return 1;
  }
  if (sqlite3_step(stmt_create) != SQLITE_DONE) {
    printf("Failed to run create table statement: %s\n", sqlite3_errmsg(db));
    return 1;
  }
  sqlite3_finalize(stmt_create);

  // insert values to reach 2GB
  sqlite3_stmt* stmt_insert;
  if (sqlite3_prepare_v2(db, SQL_INSERT_VAL, -1, &stmt_insert, NULL) != SQLITE_OK) {
    printf("Failed to prepare insert table statement: %s\n", sqlite3_errmsg(db));
    return 1;
  }

  // begin transaction
  if (!execute_query(db, "begin")) {
    return 1;
  }

  char* buffer = malloc(VAL_LEN + 1);
  for (int64_t i = 0; i < VAL_NUM; i++) {
    rand_str(buffer, VAL_LEN);
    if (sqlite3_bind_text(stmt_insert, 1, buffer, VAL_LEN, NULL) != SQLITE_OK) {
      printf("Failed to bind value `%s`: %s\n", buffer, sqlite3_errmsg(db));
      return 1;
    }
    if (sqlite3_step(stmt_insert) != SQLITE_DONE) {
      printf("Failed to run insert statement: %s\n", sqlite3_errmsg(db));
      return 1;
    }
    if (sqlite3_reset(stmt_insert) != SQLITE_OK) {
      printf("Failed to reset statement: %s\n", sqlite3_errmsg(db));
      return 1;
    }
  }

  // end transaction
  if (!execute_query(db, "commit")) {
    return 1;
  }

  sqlite3_finalize(stmt_insert);
  sqlite3_close(db);

  printf("Database created successfully.\n");

  return 0;
}
