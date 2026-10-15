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
    const shared = { sidebarProjectScopeKeys: ["goldflower"] };
    const first = memoryStorage();
    const second = memoryStorage();

    rememberWindowProjectScope(["eventintel", "t3code"], first);
    rememberWindowProjectScope([], second);

    expect(withWindowProjectScope(shared, first).sidebarProjectScopeKeys).toEqual([
      "eventintel",
      "t3code",
    ]);
    expect(withWindowProjectScope(shared, second).sidebarProjectScopeKeys).toEqual([]);
    expect(withWindowProjectScope(shared, memoryStorage()).sidebarProjectScopeKeys).toEqual([
      "goldflower",
    ]);
  });

  it("reads the single key older builds stored", () => {
    const legacy = memoryStorage();
    legacy.setItem("t3code:window-sidebar-project-scope:v1", JSON.stringify("eventintel"));
    const cleared = memoryStorage();
    cleared.setItem("t3code:window-sidebar-project-scope:v1", "null");

    expect(
      withWindowProjectScope({ sidebarProjectScopeKeys: [] }, legacy).sidebarProjectScopeKeys,
    ).toEqual(["eventintel"]);
    expect(
      withWindowProjectScope({ sidebarProjectScopeKeys: ["x"] }, cleared).sidebarProjectScopeKeys,
    ).toEqual([]);
  });
});
