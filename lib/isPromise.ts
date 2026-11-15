export function isPromise<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
