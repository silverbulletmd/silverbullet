export type ShellRequest = {
  cmd: string;
  args: string[];
};

export type ShellResponse = {
  stdout: string;
  stderr: string;
  code: number;
};
