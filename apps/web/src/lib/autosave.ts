/** Trailing debounce that can be flushed (run the pending value now). */
export function createDebounced<T>(fn: (value: T) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | null = null;
  function run() {
    clearTimeout(timer);
    timer = undefined;
    const p = pending;
    pending = null;
    if (p) fn(p.value);
  }
  return {
    push(value: T) {
      pending = { value };
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    },
    flush: run,
  };
}
