import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useResource } from "@/lib/use-resource";

describe("useResource", () => {
  it("loads on mount", async () => {
    const load = async () => "hello";
    const { result } = renderHook(() => useResource(load));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe("hello"));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("reports the error message, or a default", async () => {
    const failWithError = () => Promise.reject(new Error("down"));
    const failWithText = () => Promise.reject("x");
    const a = renderHook(() => useResource(failWithError));
    await waitFor(() => expect(a.result.current.error).toBe("down"));
    const b = renderHook(() => useResource(failWithText));
    await waitFor(() => expect(b.result.current.error).toBe("Failed to load"));
    expect(b.result.current.loading).toBe(false);
  });

  it("reload loads again", async () => {
    let n = 0;
    const load = async () => ++n;
    const { result } = renderHook(() => useResource(load));
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe(2);
  });

  it("a slow older load never overwrites a newer one", async () => {
    const resolvers: Array<(v: string) => void> = [];
    const load = () => new Promise<string>((r) => resolvers.push(r));
    const { result } = renderHook(() => useResource(load));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    act(() => {
      void result.current.reload();
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => {
      resolvers[1]("new");
    });
    await act(async () => {
      resolvers[0]("old");
    });
    expect(result.current.data).toBe("new");
    expect(result.current.loading).toBe(false);
  });

  it("sets nothing after unmount", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolve!: (v: string) => void;
    const load = () => new Promise<string>((r) => { resolve = r; });
    const { unmount } = renderHook(() => useResource(load));
    unmount();
    resolve("late");
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
