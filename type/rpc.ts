export type ShellRequest = {
  cmd: string;
  args: string[];
  stdin?: string;
};

export type ShellResponse = {
  stdout: string;
  stderr: string;
  code: number;
};
