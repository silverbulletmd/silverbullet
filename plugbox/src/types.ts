export type EventHook = {
  events: { [key: string]: string[] };
};

export type WorkerMessageType = "load" | "invoke" | "syscall-response";

export type WorkerMessage = {
  type: WorkerMessageType;
  id?: number;
  name?: string;
  code?: string;
  args?: any[];
  result?: any;
  error?: any;
};

export type ControllerMessageType = "inited" | "result" | "syscall";

export type ControllerMessage = {
  type: ControllerMessageType;
  id?: number;
  name?: string;
  args?: any[];
  error?: string;
  result?: any;
};

export interface Manifest<HookT> {
  hooks: HookT & EventHook;
  functions: {
    [key: string]: FunctionDef;
  };
}

export interface FunctionDef {
  path?: string;
  code?: string;
}

export interface WorkerLike {
  onMessage?: (message: any) => Promise<void>;
  postMessage(message: any): void;
  terminate(): void;
}
