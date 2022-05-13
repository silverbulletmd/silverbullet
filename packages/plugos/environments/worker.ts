import type { LogLevel } from "./custom_logger";

export type ControllerMessageType =
  | "inited"
  | "dependency-inited"
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
};

export interface WorkerLike {
  ready: Promise<void>;
  onMessage?: (message: any) => Promise<void>;

  postMessage(message: any): void;

  terminate(): void;
}

export type WorkerMessageType =
  | "load"
  | "load-dependency"
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
