export type ControllerMessageType = "inited" | "result" | "syscall";

export type ControllerMessage = {
  type: ControllerMessageType;
  id?: number;
  name?: string;
  args?: any[];
  error?: string;
  result?: any;
};

export interface WorkerLike {
  ready: Promise<void>;
  onMessage?: (message: any) => Promise<void>;

  postMessage(message: any): void;

  terminate(): void;
}

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
