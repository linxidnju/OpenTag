export class AsyncQueue {
  constructor() {
    this.items = [];
    this.resolvers = [];
    this.closed = false;
    this.error = null;
  }

  push(item) {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ value: item, done: false });
    else this.items.push(item);
  }

  fail(error) {
    if (this.closed) return;
    this.error = error;
    this.closed = true;
    while (this.resolvers.length) {
      const resolver = this.resolvers.shift();
      resolver(Promise.reject(error));
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length) {
      const resolver = this.resolvers.shift();
      resolver({ done: true });
    }
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.error) return Promise.reject(this.error);
        if (this.closed) return Promise.resolve({ done: true });
        return new Promise((resolve) => this.resolvers.push(resolve));
      }
    };
  }
}
