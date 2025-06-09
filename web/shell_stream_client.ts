import type { HttpSpacePrimitives } from "../lib/spaces/http_space_primitives.ts";

/**
 * Event types emitted by the ShellStreamClient
 */
export type ShellStreamEventType =
  | "stdout"
  | "stderr"
  | "exit"
  | "error"
  | "open"
  | "close";

/**
 * Event object emitted by the ShellStreamClient
 */
export interface ShellStreamEvent {
  type: ShellStreamEventType;
  data: string | { code: number };
}

/**
 * Options for creating a ShellStreamClient
 */
export interface ShellStreamOptions {
  /**
   * HTTP space primitives for authenticated requests
   */
  httpSpacePrimitives: HttpSpacePrimitives;

  /**
   * Command to execute
   */
  cmd: string;

  /**
   * Command arguments
   */
  args?: string[];
}

/**
 * Client for interacting with the shell stream WebSocket API
 */
export class ShellStreamClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Map<
    ShellStreamEventType,
    Array<(event: ShellStreamEvent) => void>
  >();

  constructor(private options: ShellStreamOptions) {
    // Set default options
    this.options.args = options.args ?? [];
  }

  /**
   * Connect to the shell stream WebSocket
   */
  public async start(): Promise<void> {
    if (this.ws) {
      return Promise.resolve(); // Already connected
    }

    // Create an authenticated WebSocket connection
    this.ws = await this.options.httpSpacePrimitives
      .createAuthenticatedWebSocket(
        ".shell/stream",
        {
          cmd: this.options.cmd,
          args: JSON.stringify(this.options.args || []),
        },
      );

    // Set up event handlers
    this.setupEventHandlers();

    // Wait for the connection to be established
    return new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not initialized"));
        return;
      }

      const onOpen = () => {
        this.ws?.removeEventListener("open", onOpen);
        this.ws?.removeEventListener("error", onError);
        resolve();
      };

      const onError = (error: Event) => {
        this.ws?.removeEventListener("open", onOpen);
        this.ws?.removeEventListener("error", onError);
        reject(new Error(`Failed to connect: ${error}`));
      };

      this.ws.addEventListener("open", onOpen);
      this.ws.addEventListener("error", onError);
    });
  }

  /**
   * Set up WebSocket event handlers
   * @private
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    // Set up event handlers
    this.ws.onopen = () => {
      this.emitEvent({ type: "open", data: "Connected" });
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        // Special handling for exit events
        if (message.type === "exit") {
          // Parse the exit code from the JSON string if needed
          let exitData = message.data;
          if (typeof exitData === "string" && typeof exitData === "string") {
            try {
              // Try to parse as JSON in case it's a stringified object
              const parsedData = JSON.parse(exitData);
              if (
                typeof parsedData === "object" && parsedData !== null &&
                "code" in parsedData
              ) {
                exitData = parsedData;
              }
            } catch (e) {
              // If it's not valid JSON, just use it as is
              console.error("Failed to parse exit data:", e);
            }
          }

          this.emitEvent({
            type: message.type,
            data: exitData,
          });
        } else {
          // Regular event
          this.emitEvent({
            type: message.type,
            data: message.data,
          });
        }
      } catch (e) {
        const error = e as Error;
        this.emitEvent({
          type: "error",
          data: `Error parsing message: ${error.message}`,
        });
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.emitEvent({ type: "close", data: "Disconnected" });
    };

    this.ws.onerror = (error) => {
      this.emitEvent({
        type: "error",
        data: `WebSocket error: ${error}`,
      });
    };
  }

  /**
   * Close the WebSocket connection
   */
  public close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send data to the process stdin
   */
  public send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    this.ws.send(JSON.stringify({
      type: "stdin",
      data,
    }));
  }

  /**
   * Send a signal to the process
   * @param signal The signal to send (e.g., "SIGTERM", "SIGINT", "SIGKILL", "SIGHUP")
   * @throws Error if the WebSocket is not connected
   */
  public kill(signal: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    this.ws.send(JSON.stringify({
      type: "signal",
      signal,
    }));
  }

  /**
   * Register an event handler
   */
  public addEventListener(
    eventType: ShellStreamEventType,
    handler: (event: ShellStreamEvent) => void,
  ): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }

    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Remove an event handler
   */
  public removeEventListener(
    eventType: ShellStreamEventType,
    handler: (event: ShellStreamEvent) => void,
  ): void {
    if (!this.eventHandlers.has(eventType)) {
      return;
    }

    const handlers = this.eventHandlers.get(eventType)!;
    const index = handlers.indexOf(handler);

    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Emit an event to all registered handlers
   */
  private emitEvent(event: ShellStreamEvent): void {
    // Call handlers for the specific event type
    if (this.eventHandlers.has(event.type)) {
      for (const handler of this.eventHandlers.get(event.type)!) {
        handler(event);
      }
    }
  }
}
