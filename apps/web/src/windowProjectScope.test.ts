import { describe, expect, it } from "vite-plus/test";

import { rememberWindowProjectScope, withWindowProjectScope } from "./windowProjectScope";

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

describe("windowProjectScope", () => {
  it("keeps a separate scope per window and falls back to the shared one", () => {
    const shared = { sidebarProjectScopeKey: "goldflower" };
    const first = memoryStorage();
    const second = memoryStorage();

    rememberWindowProjectScope("eventintel", first);
    rememberWindowProjectScope(null, second);

    expect(withWindowProjectScope(shared, first).sidebarProjectScopeKey).toBe("eventintel");
    expect(withWindowProjectScope(shared, second).sidebarProjectScopeKey).toBeNull();
    expect(withWindowProjectScope(shared, memoryStorage()).sidebarProjectScopeKey).toBe(
      "goldflower",
    );
  });
});
