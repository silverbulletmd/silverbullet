import { Wasm } from "../build/sqlite.js";
import { getStr } from "./wasm.ts";
import { Status } from "./constants.ts";

/**
 * Errors which can occur while interacting with
 * a database.
 */
export class SqliteError extends Error {
  /**
   * Extension over the standard JS Error object
   * to also contain class members for error code
   * and error code name.
   *
   * Instances of this class should not be constructed
   * directly and should only be obtained
   * from exceptions raised in this module.
   */
  constructor(context: Wasm | string, code?: Status) {
    let message;
    let status;
    if (typeof context === "string") {
      message = context;
      status = Status.Unknown;
    } else {
      message = getStr(context, context.get_sqlite_error_str());
      status = context.get_status();
    }
    super(message);
    this.code = code ?? status;
    this.name = "SqliteError";
  }

  /**
   * The SQLite status code which caused this error.
   *
   * Errors that originate in the JavaScript part of
   * the library will not have an associated status
   * code. For these errors, the code will be
   * `Status.Unknown`.
   *
   * These codes are accessible via
   * the exported `Status` object.
   */
  code: Status;

  /**
   * Key of code in exported `status`
   * object.
   *
   * E.g. if `code` is `19`,
   * `codeName` would be `SqliteConstraint`.
   */
  get codeName(): keyof typeof Status {
    return Status[this.code] as keyof typeof Status;
  }
}
