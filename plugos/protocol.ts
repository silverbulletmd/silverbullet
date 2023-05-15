import type { Manifest } from "../common/manifest.ts";
import type { LogLevel } from "./runtime/custom_logger.ts";

// Messages received from the worker
export type ControllerMessage =
  | {
    // Parsed manifest when worker is initialized
    type: "manifest";
    manifest: Manifest;
  }
  | {
    // Function invocation result
    type: "invr";
    id: number;
    error?: string;
    stack?: string;
    result?: any;
  }
  | {
    // Syscall
    type: "sys";
    id: number;
    name: string;
    args: any[];
  }
  | {
    // Log message
    type: "log";
    level: LogLevel;
    message: string;
  };

// Messages received inside the worker
export type WorkerMessage =
  | {
    // Function invocation
    type: "inv";
    id: number;
    name: string;
    args: any[];
  }
  | {
    // Syscall result
    type: "sysr";
    id: number;
    result?: any;
    error?: any;
  };
