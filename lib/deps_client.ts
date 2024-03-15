// Remember to keep in sync with import_map.json !
// We have to use different deps for client and server as esbuild doesn't
// support wildcard exporting. See https://github.com/evanw/esbuild/issues/1420
export {
  type IDBPDatabase,
  openDB,
} from "https://esm.sh/idb@7.1.1/with-async-ittr";
