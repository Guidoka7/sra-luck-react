import { afterEach, expect, it, vi } from "vitest";
import { cachedPublicRead, invalidatePublicRead } from "./public-read-cache";

afterEach(() => vi.useRealTimers());

it("coalesces shared catalog reads and invalidates after a write", async () => {
  const key = "test-project:catalog";
  let resolve!: (value: string[]) => void;
  const loader = vi.fn(() => new Promise<string[]>((done) => { resolve = done; }));
  const first = cachedPublicRead(key, loader);
  const second = cachedPublicRead(key, loader);
  expect(loader).toHaveBeenCalledTimes(1);
  resolve(["before"]);
  expect(await first).toEqual(["before"]);
  expect(await second).toEqual(["before"]);
  expect(await cachedPublicRead(key, loader)).toEqual(["before"]);
  expect(loader).toHaveBeenCalledTimes(1);
  invalidatePublicRead(key);
  const refreshed = cachedPublicRead(key, loader);
  resolve(["after"]);
  expect(await refreshed).toEqual(["after"]);
  expect(loader).toHaveBeenCalledTimes(2);
  invalidatePublicRead(key);
});

it("bounds staleness and retries a failed refresh", async () => {
  vi.useFakeTimers();
  const key = "test-project:config";
  const loader = vi.fn().mockResolvedValueOnce("old").mockRejectedValueOnce(new Error("REST unavailable")).mockResolvedValueOnce("new");
  expect(await cachedPublicRead(key, loader)).toBe("old");
  await vi.advanceTimersByTimeAsync(36_000);
  await expect(cachedPublicRead(key, loader)).rejects.toThrow("REST unavailable");
  expect(await cachedPublicRead(key, loader)).toBe("new");
  invalidatePublicRead(key);
});
