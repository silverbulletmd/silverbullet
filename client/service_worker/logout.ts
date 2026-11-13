import { requestLogoutMessage } from "../logout.ts";

type LogoutClient = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

export class WorkerLogout {
  private attempt?: {
    id: string;
    clients: LogoutClient[];
    ready: boolean;
    revoked: boolean;
    preserved: boolean;
  };
  private cleared = false;
  private expiry?: ReturnType<typeof setTimeout>;

  constructor(
    private clients: () => Promise<LogoutClient[]>,
    private clear: () => Promise<void>,
    private synchronize: () => Promise<string[]> = async () => [],
  ) {}

  get active(): boolean {
    return this.cleared || this.attempt !== undefined;
  }

  async handle(
    message: { type: string; id: string; localLockIncomplete?: boolean },
    port?: MessagePort,
  ): Promise<void> {
    try {
      if (message.type === "logout-force") {
        clearTimeout(this.expiry);
        this.cleared = true;
        await this.clear();
        const clients = await this.clients();
        for (const client of clients) client.postMessage(message);
        port?.postMessage({ ok: true });
      } else if (message.type === "logout-sync") {
        if (this.active) throw new Error("Another logout is in progress.");
        const attempt = {
          id: message.id,
          clients: [] as LogoutClient[],
          ready: false,
          revoked: false,
          preserved: false,
        };
        this.attempt = attempt;
        this.expiry = setTimeout(() => {
          void this.handle({
            type: this.cleared
              ? "logout-complete"
              : attempt.revoked
                ? "logout-preserve"
                : "logout-cancel",
            id: message.id,
            localLockIncomplete: true,
          });
        }, 30_000);
        attempt.clients = await this.clients();
        if (this.attempt !== attempt) throw new Error("Logout was canceled.");
        if (attempt.preserved) {
          for (const client of attempt.clients)
            client.postMessage({ type: "logout-preserve", id: message.id });
          return;
        }
        const saving = Promise.all(
          attempt.clients.map((client) =>
            requestLogoutMessage(client, {
              type: "logout-save",
              id: message.id,
            }),
          ),
        );
        if (attempt.revoked) {
          for (const client of attempt.clients)
            client.postMessage({ type: "logout-revoked", id: message.id });
        }
        await saving;
        if (this.attempt !== attempt) throw new Error("Logout was canceled.");
        if (attempt.preserved) return;
        const databases = await this.synchronize();
        if (this.attempt !== attempt || this.cleared)
          throw new Error("Logout was canceled.");
        attempt.ready = true;
        port?.postMessage({ ok: true, databases });
      } else if (this.attempt?.id === message.id) {
        const attempt = this.attempt;
        if (message.type === "logout-revoked") {
          attempt.revoked = true;
          for (const client of attempt.clients) client.postMessage(message);
        } else if (message.type === "logout-preserve") {
          attempt.revoked = true;
          attempt.preserved = true;
          clearTimeout(this.expiry);
          for (const client of attempt.clients) client.postMessage(message);
        } else if (message.type === "logout-clear") {
          if (!attempt.ready || attempt.preserved)
            throw new Error("Open tabs have not finished saving.");
          this.cleared = true;
          await this.clear();
          port?.postMessage({ ok: true });
        } else if (message.type === "logout-complete") {
          if (!attempt.ready || attempt.preserved)
            throw new Error("Open tabs have not finished saving.");
          clearTimeout(this.expiry);
          for (const client of attempt.clients) client.postMessage(message);
        } else {
          clearTimeout(this.expiry);
          if (!attempt.revoked) this.attempt = undefined;
          else attempt.preserved = true;
          for (const client of attempt.clients)
            client.postMessage({
              type: attempt.revoked ? "logout-preserve" : "logout-cancel",
              id: message.id,
            });
        }
      } else {
        throw new Error("Logout preparation expired. Try again.");
      }
    } catch (error) {
      port?.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "Could not log out.",
      });
    }
  }
}
