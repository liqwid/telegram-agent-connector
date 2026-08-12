export type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
};

/**
 * A promise with its settle functions exposed — the bridge between gramjs's
 * callback-style auth (which awaits a password from a callback) and the HTTP
 * layer (where the password arrives in a later request).
 */
export function createDeferred<Value>(): Deferred<Value> {
  const { promise, resolve, reject } = Promise.withResolvers<Value>();
  return { promise, resolve, reject };
}
