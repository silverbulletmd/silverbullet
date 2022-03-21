export abstract class EventEmitter<HandlerT> {
  private handlers: Partial<HandlerT>[] = [];

  on(handlers: Partial<HandlerT>) {
    this.handlers.push(handlers);
  }

  off(handlers: Partial<HandlerT>) {
    this.handlers = this.handlers.filter((h) => h !== handlers);
  }

  emit(eventName: keyof HandlerT, ...args: any[]) {
    for (let handler of this.handlers) {
      let fn: any = handler[eventName];
      if (fn) {
        fn(...args);
      }
    }
  }
}
