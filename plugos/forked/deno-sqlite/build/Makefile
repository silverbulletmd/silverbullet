DENO ?= deno
WASI ?= ./wasi-sdk
CC    = $(WASI)/bin/clang

OUT_WA = "sqlite.wasm"
OUT_BN = "sqlite.js"
OUT_TY = "sqlite.d.ts"

SQLITE_DLD = "https://sqlite.org/2022/sqlite-src-3390200.zip"
SQLITE_DIR = "sqlite-src-3390200"

WASI_DLD = "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-16/wasi-sdk-16.0-linux.tar.gz"
WASI_TAR = wasi_dl_linux.tar.gz
ifeq ($(shell uname), Darwin)
	WASI_DLD = "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-16/wasi-sdk-16.0-macos.tar.gz"
	WASI_TAR = wasi_dl_darwin.tar.gz
endif

CSRC  = ""
CSRC += $(shell find ./src  -name "*.c")
CSRC += $(shell find ./lib  -name "*.c")
CSRC += $(shell find ./hask -name "*.c")
FLGS  = -Wall
RFLG  = -Os
DFLG  = -DDEBUG_BUILD
WAFLG = --target=wasm32-unknown-wasi -Wl,--no-entry -nostartfiles --sysroot $(WASI)/share/wasi-sysroot\
        -DWASI_BUILD -Wl,--export,malloc -Wl,--export,free -Wl,--allow-undefined-file=vfs.syms
INCS  = -Ilib

# Location of wrapper library which contains all c-land export
CWRP = "./src/wrapper.c"

# Configure sqlite for out use-case
SQLFLG = -DSQLITE_DQS=0 -DSQLITE_THREADSAFE=0 -DSQLITE_LIKE_DOESNT_MATCH_BLOBS\
         -DSQLITE_DEFAULT_FOREIGN_KEYS=1 -DSQLITE_TEMP_STORE=2\
         -DSQLITE_OMIT_DEPRECATED -DSQLITE_OMIT_UTF16 -DSQLITE_OMIT_SHARED_CACHE\
         -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_OMIT_PROGRESS_CALLBACK -DSQLITE_OMIT_TRACE\
         -DSQLITE_OS_OTHER=1 -DSQLITE_OMIT_COMPLETE -DSQLITE_OMIT_WAL\
         -DNDEBUG=1 -DSQLITE_ENABLE_COLUMN_METADATA -DHAVE_LOCALTIME_R\
         -DSQLITE_OMIT_DESERIALIZE -DSQLITE_ENABLE_FTS5
# Rational:
# SQLITE_DQS -> we do not need to have backwards comp
# SQLITE_THREADSAFE -> we run single-threaded
# SQLITE_LIKE_DOESNT_MATCH_BLOBS -> faster (is recommended if no backwards comp)
# SQLITE_DEFAULT_FOREIGN_KEYS -> this should be the default
# SQLITE_TEMP_STORE -> in memory is faster, so it's the better default
# SQLITE_OMIT_DEPRECATED -> we do not need to have backwards comp
# SQLITE_OMIT_UTF16 -> we only support utf-8 encoded strings
# SQLITE_OMIT_SHARED_CACHE -> we only ever open one connection
# SQLITE_OMIT_LOAD_EXTENSION -> we don't use it
# SQLITE_OMIT_PROGRESS_CALLBACK -> we don't use it
# SQLITE_OMIT_TRACE -> we make no use of these
# SQLITE_OS_OTHER -> we provide our own vfs
# SQLITE_OMIT_COMPLETE -> we don't need these
# SQLITE_OMIT_WAL -> this is doggy, as we can not memory map files
# DNDEBUG -> "use for maximum speed"
# SQLITE_ENABLE_COLUMN_METADATA -> we depend on column metadata interfaces (`sqlite3_column_table_name` and `sqlite3_column_origin_name`)
# SQLITE_OMIT_DESERIALIZE -> we don't use these interfaces

all: release

build:
	$(DENO) run --allow-read --allow-write hack/gen_syms.js vfs.syms
	$(CC) $(WAFLG) $(FLGS) $(INCS) $(CSRC) $(SQLFLG) -o $(OUT_WA)

bundle:
	$(DENO) run --allow-read --allow-write hack/bundle.js $(OUT_WA) $(OUT_BN)
	$(DENO) fmt $(OUT_BN)

types:
	$(DENO) run --allow-read --allow-write hack/gen_types.ts $(CWRP) $(OUT_TY)
	$(DENO) fmt $(OUT_TY)

size.txt: sqlite.js sqlite.wasm
	rm -f size.txt *.gz *.br
	gzip --best < sqlite.js > sqlite.js.gz
	gzip --best < sqlite.wasm > sqlite.wasm.gz
	brotli --best -o sqlite.js.br < sqlite.js && \
	brotli --best -o sqlite.wasm.br < sqlite.wasm || \
		echo "WARN: brotli size comparison unavailable"
	ls -l sqlite.* | awk '{printf "%-15s➜%7s bytes\n",$$9,$$5}' | tee size.txt

debug: FLGS += $(DFLG)
debug: build
debug: bundle
debug: types

release: FLGS += $(RFLG)
release: build
release: bundle
release: types
release: size.txt

amalgamation:
	make -C sqlite-src clean
	make -C sqlite-src sqlite3.c SQLFLG="$(SQLFLG)"
	mv sqlite-src/sqlite3.c lib/sqlite3.c
	mv sqlite-src/sqlite3.h lib/sqlite3.h

dlsqlite:
	curl "$(SQLITE_DLD)" -o "sqlite_dl.zip"
	sed -n '/sqlite_dl.zip/p' ".checksums" | shasum -c -
	rm -rf "sqlite-src"
	unzip "sqlite_dl.zip"
	mv $(SQLITE_DIR) "sqlite-src"
	cp "Makefile.sqlite" "sqlite-src/Makefile"
	rm "sqlite_dl.zip"

dlwasi:
	curl -L "$(WASI_DLD)" -o "$(WASI_TAR)"
	sed -n '/${WASI_TAR}/p' ".checksums" | shasum -c -
	rm -rf "wasi-sdk"
	tar -xzvf "$(WASI_TAR)"
	mv "wasi-sdk-16.0" "wasi-sdk"
	rm "${WASI_TAR}"

testdb:
	gcc -Ilib lib/sqlite3.c hack/gen_test_db.c -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -o gen_test_db
	rm -f 2GB_test.db
	./gen_test_db
	rm gen_test_db

setup: dlsqlite
setup: dlwasi

clean:
	rm -rf sqlite-src
	rm -rf wasi-sdk
	rm -f  2GB_test.db

.PHONY: build amalgamation dlsqlite dlwasi setup clean
