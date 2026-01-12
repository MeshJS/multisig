// Prevent third-party libraries from throwing when redefining Array.prototype.chunk
// by defining a configurable placeholder implementation first.

declare global {
  interface Array<T> {
    chunk?(size: number): T[][];
  }
}

if (!Object.prototype.hasOwnProperty.call(Array.prototype, "chunk")) {
  Object.defineProperty(Array.prototype, "chunk", {
    value: function <T>(this: T[], size: number): T[][] {
      const n = Math.max(1, Number(size) || 1);
      const result: T[][] = [];
      for (let i = 0; i < this.length; i += n) {
        result.push(this.slice(i, i + n));
      }
      return result;
    },
    writable: true,
    configurable: true,
  });
}

export {};


