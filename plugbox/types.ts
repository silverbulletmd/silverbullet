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

export type EventHook = {
  events?: { [key: string]: string[] };
};

export type EndpointHook = {
  endpoints?: EndPointDef[];
};
export type EndPointDef = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  handler: string; // function name
};

export type CronHook = {
  crons?: CronDef[];
};

export type CronDef = {
  cron: string;
  handler: string; // function name
};

export interface WorkerLike {
  ready: Promise<void>;
  onMessage?: (message: any) => Promise<void>;
  postMessage(message: any): void;
  terminate(): void;
}
