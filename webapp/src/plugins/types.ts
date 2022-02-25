export interface Manifest {
  events: { [key: string]: string[] };
  commands: {
    [key: string]: CommandDef;
  };
  functions: {
    [key: string]: FunctionDef;
  };
}

export const slashCommandRegexp = /\/[\w\-]*/;

export interface CommandDef {
  // Function name to invoke
  invoke: string;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;

  // If to show in slash invoked menu and if so, with what label
  // should match slashCommandRegexp
  slashCommand?: string;

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
