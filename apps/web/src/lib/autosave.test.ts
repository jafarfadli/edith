import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebounced } from "@/lib/autosave";

describe("createDebounced", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("saves only the latest value after the delay", () => {
    const fn = vi.fn();
    const d = createDebounced<number>(fn, 500);
    d.push(1); d.push(2);
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it("flush runs a pending save immediately, once", () => {
    const fn = vi.fn();
    const d = createDebounced<number>(fn, 500);
    d.push(7);
    d.flush();
    expect(fn).toHaveBeenCalledWith(7);
    vi.advanceTimersByTime(1000);
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing pending is a no-op", () => {
    const fn = vi.fn();
    createDebounced<number>(fn, 500).flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
