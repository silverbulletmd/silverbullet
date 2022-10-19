import { getStr } from "../src/wasm.ts";

const DB_NAME = "sqlitevfs";
const LOADED_FILES = new Map();
const OPEN_FILES = new Map();

function nextRid() {
  const rid = (nextRid?.LAST_RID ?? 0) + 1;
  nextRid.LAST_RID = rid;
  return rid;
}

function getOpenFile(rid) {
  if (!OPEN_FILES.has(rid)) {
    throw new Error(`Resource ID ${rid} does not exist.`);
  }
  return OPEN_FILES.get(rid);
}

const MIN_GROW_BYTES = 2048;
const MAX_GROW_BYTES = 65536;

class Buffer {
  constructor(data) {
    this._data = data ?? new Uint8Array();
    this._size = this._data.length;
  }

  get size() {
    return this._size;
  }

  read(offset, buffer) {
    if (offset >= this._size) return 0;
    const toCopy = this._data.subarray(
      offset,
      Math.min(this._size, offset + buffer.length),
    );
    buffer.set(toCopy);
    return toCopy.length;
  }

  reserve(capacity) {
    if (this._data.length >= capacity) return;
    const neededBytes = capacity - this._data.length;
    const growBy = Math.min(
      MAX_GROW_BYTES,
      Math.max(MIN_GROW_BYTES, this._data.length),
    );
    const newArray = new Uint8Array(
      this._data.length + Math.max(growBy, neededBytes),
    );
    newArray.set(this._data);
    this._data = newArray;
  }

  write(offset, buffer) {
    this.reserve(offset + buffer.length);
    this._data.set(buffer, offset);
    this._size = Math.max(this._size, offset + buffer.length);
    return buffer.length;
  }

  truncate(size) {
    this._size = size;
  }

  toUint8Array() {
    return this._data.subarray(0, this._size);
  }
}

const indexedDB = window.indexedDB || window.mozIndexedDB ||
  window.webkitIndexedDB || window.msIndexedDB || window.shimIndexedDB;

// Web browser indexedDB database
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () =>
    request.result.createObjectStore("files", { keyPath: "name" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function loadFile(fileName) {
  const db = await database;
  const file = await new Promise((resolve, reject) => {
    const store = db.transaction("files", "readonly").objectStore("files");
    const request = store.get(fileName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (file != null && !LOADED_FILES.has(fileName)) {
    const buffer = new Buffer(file.data);
    LOADED_FILES.set(fileName, buffer);
    return buffer;
  } else if (LOADED_FILES.has(fileName)) {
    return LOADED_FILES.get(fileName);
  } else {
    return null;
  }
}

async function syncFile(fileName, data) {
  const db = await database;
  await new Promise((resolve, reject) => {
    const store = db.transaction("files", "readwrite").objectStore("files");
    const request = store.put({ name: fileName, data });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteFile(fileName) {
  const db = await database;
  await new Promise((resolve, reject) => {
    const store = db.transaction("files", "readwrite").objectStore("files");
    const request = store.delete(fileName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function writeFile(fileName, data) {
  await syncFile(fileName, data);
  if (LOADED_FILES.has(fileName)) {
    const buffer = LOADED_FILES.get(fileName);
    buffer.truncate(0);
    buffer.write(0, data);
  }
}

// Closure to return an environment that links
// the current wasm context. This is a modified
// version, suitable for use within browsers.
export default function env(inst) {
  const env = {
    js_print: (str_ptr) => {
      const text = getStr(inst.exports, str_ptr);
      console.log(text[text.length - 1] === "\n" ? text.slice(0, -1) : text);
    },
    js_open: (path_ptr, mode, _flags) => {
      if (mode === 1 /* temp file */) {
        const rid = nextRid();
        OPEN_FILES.set(rid, { path: null, buffer: new Buffer() });
        return rid;
      } else if (mode === 0 /* regular file */) {
        const path = getStr(inst.exports, path_ptr);
        const buffer = LOADED_FILES.get(path) ?? new Buffer();
        if (!LOADED_FILES.has(path)) LOADED_FILES.set(path, buffer);
        const rid = nextRid();
        OPEN_FILES.set(rid, { path, buffer });
        return rid;
      }
    },
    js_close: (rid) => {
      OPEN_FILES.delete(rid);
    },
    js_delete: (path_ptr) => {
      const path = getStr(inst.exports, path_ptr);
      LOADED_FILES.delete(path);
      deleteFile(path);
    },
    js_read: (rid, buffer_ptr, offset, amount) => {
      const buffer = new Uint8Array(
        inst.exports.memory.buffer,
        buffer_ptr,
        amount,
      );
      const file = getOpenFile(rid);
      return file.buffer.read(offset, buffer);
    },
    js_write: (rid, buffer_ptr, offset, amount) => {
      const buffer = new Uint8Array(
        inst.exports.memory.buffer,
        buffer_ptr,
        amount,
      );
      const file = getOpenFile(rid);
      return file.buffer.write(offset, buffer);
    },
    js_truncate: (rid, size) => {
      getOpenFile(rid).buffer.truncate(size);
    },
    js_sync: (rid) => {
      const file = getOpenFile(rid);
      if (file.path != null) syncFile(file.path, file.buffer.toUint8Array());
    },
    js_size: (rid) => {
      return getOpenFile(rid).buffer.size;
    },
    js_lock: (_rid, _exclusive) => {},
    js_unlock: (_rid) => {},
    js_time: () => {
      return Date.now();
    },
    js_timezone: () => {
      return (new Date()).getTimezoneOffset();
    },
    js_exists: (path_ptr) => {
      const path = getStr(inst.exports, path_ptr);
      return LOADED_FILES.has(path) ? 1 : 0;
    },
    js_access: (_path_ptr) => 1,
  };

  return { env };
}
