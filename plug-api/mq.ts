export type Message = {
  id: string;
  queue: string;
  body: any;
  retries?: number;
};
