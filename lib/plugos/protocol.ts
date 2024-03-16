import type { Manifest } from "../manifest.ts";

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
    result?: any;
  }
  | {
    // Syscall
    type: "sys";
    id: number;
    name: string;
    args: any[];
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
