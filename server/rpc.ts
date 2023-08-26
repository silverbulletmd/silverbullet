export type ShellRequest = {
  cmd: string;
  args: string[];
};

export type ShellResponse = {
  stdout: string;
  stderr: string;
  code: number;
};

export type SyscallRequest = {
  ctx: string; // Plug name requesting
  name: string;
  args: any[];
};

export type SyscallResponse = {
  result?: any;
  error?: string;
};
