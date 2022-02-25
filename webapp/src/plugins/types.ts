export interface Manifest {
  events: { [key: string]: string[] };
  commands: {
    [key: string]: CommandDef;
  };
  functions: {
    [key: string]: FunctionDef;
  };
}

export interface CommandDef {
  // Function name to invoke
  invoke: string;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;
  // Required context to be passed in as function arguments
  requiredContext?: {
    text?: boolean;
  };
}

export interface FunctionDef {
  path: string;
  functionName?: string;
  code?: string;
}
