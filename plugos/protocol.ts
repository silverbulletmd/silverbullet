import { Manifest } from "../common/manifest.ts";
import type { LogLevel } from "./runtime/custom_logger.ts";

export type ControllerMessageType =
  | "inited"
  | "result"
  | "syscall"
  | "log";

export type ControllerMessage = {
  type: ControllerMessageType;
  id?: number;
  name?: string;
  args?: any[];
  error?: string;
  stack?: string;
  level?: LogLevel;
  message?: string;
  result?: any;
  manifest?: Manifest;
};

export interface WorkerLike {
  ready: Promise<void>;
  onMessage?: (message: any) => Promise<void>;

  postMessage(message: any): void;

  terminate(): void;
}

export type WorkerMessageType =
  | "invoke"
  | "syscall-response";

export type WorkerMessage = {
  type: WorkerMessageType;
  id?: number;
  name?: string;
  code?: string;
  args?: any[];
  result?: any;
  error?: any;
};
