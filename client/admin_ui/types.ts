export type Binding =
  | { prefix: string; host?: never }
  | { host: string; prefix?: never };

export type FieldError = {
  field: string;
  message: string;
};

export type AuthMode = {
  mode: "inherit" | "custom" | "none";
  user?: string;
};

export type SpaceInfo = {
  name: string;
  folder: string;
  binding: Binding;
  auth: AuthMode;
  readOnly: boolean;
  shell: { enabled: boolean; whitelist: string[] };
  runtimeApi: boolean;
  indexPage: string;
  hasPassword: boolean;
  status: { state: "running" | "errored"; reason?: string };
};
