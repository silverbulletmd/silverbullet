export abstract class EventEmitter<HandlerT> {
  private handlers: Partial<HandlerT>[] = [];

  on(handlers: Partial<HandlerT>) {
    this.handlers.push(handlers);
  }

  off(handlers: Partial<HandlerT>) {
    this.handlers = this.handlers.filter((h) => h !== handlers);
  }

  async emit(eventName: keyof HandlerT, ...args: any[]): Promise<void> {
    for (const handler of this.handlers) {
      const fn: any = handler[eventName];
      if (fn) {
        await Promise.resolve(fn(...args));
      }
    }
  }
}
