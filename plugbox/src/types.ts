export type EventHook = {
  events: { [key: string]: string[] };
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
