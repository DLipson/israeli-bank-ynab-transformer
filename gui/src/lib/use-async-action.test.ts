import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useAsyncAction } from "@/lib/use-async-action";

describe("useAsyncAction", () => {
  it("returns the result and ends not busy", async () => {
    const { result } = renderHook(() => useAsyncAction(async (n: number) => n * 2));
    let value: number | undefined;
    await act(async () => {
      value = await result.current.run(4);
    });
    expect(value).toBe(8);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("sets the error message and does not throw", async () => {
    const { result } = renderHook(() => useAsyncAction(() => Promise.reject(new Error("boom"))));
    await act(async () => {
      expect(await result.current.run()).toBeUndefined();
    });
    expect(result.current.error).toBe("boom");
    act(() => result.current.clearError());
    expect(result.current.error).toBe("");
  });

  it("uses a default message for a non-Error", async () => {
    const { result } = renderHook(() => useAsyncAction(() => Promise.reject("nope")));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBe("Something went wrong");
  });

  it("ignores a call while busy", async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<string>((r) => { release = () => r("done"); }));
    const { result } = renderHook(() => useAsyncAction(fn));
    let first!: Promise<string | undefined>;
    act(() => {
      first = result.current.run();
    });
    expect(result.current.busy).toBe(true);
    let second: string | undefined = "unset";
    await act(async () => {
      second = await result.current.run();
    });
    expect(second).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await first;
    });
    expect(result.current.busy).toBe(false);
  });

  it("sets no state after unmount", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const fn = () => new Promise<void>((_, reject) => { release = () => reject(new Error("late")); });
    const { result, unmount } = renderHook(() => useAsyncAction(fn));
    let pending!: Promise<void | undefined>;
    act(() => {
      pending = result.current.run();
    });
    unmount();
    release();
    await pending;
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
