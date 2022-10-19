export { DB } from "./src/db.ts";
export { SqliteError } from "./src/error.ts";
export { Status } from "./src/constants.ts";

export type { SqliteOptions } from "./src/db.ts";
export type {
  ColumnName,
  PreparedQuery,
  QueryParameter,
  QueryParameterSet,
  Row,
  RowObject,
} from "./src/query.ts";

import { compile } from "./build/sqlite.js";
await compile();
