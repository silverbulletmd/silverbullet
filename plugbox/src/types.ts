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
  data?: any;
};

export type ControllerMessageType = "inited" | "result" | "error" | "syscall";

export type ControllerMessage = {
  type: ControllerMessageType;
  id?: number;
  name?: string;
  reason?: string;
  args?: any[];
  result: any;
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
