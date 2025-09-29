/**
 * EventEmitter implementation, similar to the one used in CodeMirror
 */
export abstract class EventEmitter<HandlerT> {
  private handlers: Partial<HandlerT>[] = [];

  /**
   * Subscribe to events
   * @param handlers
   */
  on(handlers: Partial<HandlerT>) {
    this.handlers.push(handlers);
  }

  /**
   * Unsubscribe from events
   * @param handlers
   */
  off(handlers: Partial<HandlerT>) {
    this.handlers = this.handlers.filter((h) => h !== handlers);
  }

  /**
   * Broadcast an event to all subscribers
   * @param eventName
   * @param args
   */
  async emit(eventName: keyof HandlerT, ...args: any[]): Promise<void> {
    for (const handler of this.handlers) {
      const fn: any = handler[eventName];
      if (fn) {
        await Promise.resolve(fn(...args));
      }
    }
  }
}
