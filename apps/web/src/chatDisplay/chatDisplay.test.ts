import {
  chatDisplayProjectKey,
  DEFAULT_CHAT_DISPLAY_SETTINGS,
  resolveChatDisplay,
  type ChatDisplaySettings,
} from "./chatDisplayStore";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../session-logic";
import {
  chatDisplayFoldsEntry,
  chatDisplayHiddenSummary,
  chatDisplayKind,
  chatDisplayRemovesEntry,
  isReadOnlyCommand,
  timelineToolCallVisibility,
} from "./chatDisplay";

const entry = (fields: Partial<WorkLogEntry>): WorkLogEntry => ({
  id: "e",
  createdAt: "2026-01-01T00:00:00.000Z",
  label: "x",
  tone: "tool",
  toolLifecycleStatus: "completed",
  ...fields,
});
const custom = (patch: Partial<ChatDisplaySettings> = {}): ChatDisplaySettings => ({
  ...DEFAULT_CHAT_DISPLAY_SETTINGS,
  mode: "custom",
  ...patch,
});

describe("isReadOnlyCommand", () => {
  it.each([
    ["ls apps/web", true],
    ["git status --short", true],
    ["rg foo | head -5", true],
    ["bash -lc 'cat package.json'", true],
    ["vp run typecheck", false],
    ["cat a > b", false],
    ["ls && rm -rf x", false],
    ["git push", false],
  ])("%s → %s", (command, expected) => {
    expect(isReadOnlyCommand(command)).toBe(expected);
  });
});

describe("chat display rules", () => {
  const ls = entry({ itemType: "command_execution", command: "ls" });
  const typecheck = entry({ itemType: "command_execution", command: "vp run typecheck" });
  const failed = entry({ ...typecheck, toolLifecycleStatus: "failed" });
  const paper = entry({
    itemType: "dynamic_tool",
    toolData: { toolName: "mcp__paper__write_html" },
  });
  const image = entry({
    itemType: "dynamic_tool",
    requestKind: "file-read",
    viewedImagePath: "a.png",
  });

  it("classifies read-only commands as reads only when asked", () => {
    expect(chatDisplayKind(ls, custom())).toBe("read");
    expect(chatDisplayKind(ls, custom({ readOnlyCommandsAsReads: false }))).toBe("command");
    expect(chatDisplayKind(paper, custom())).toBe("paper");
  });

  it("keeps failures under Failures only and folds the rest", () => {
    const display = custom();
    expect(chatDisplayFoldsEntry(typecheck, display)).toBe(true);
    expect(chatDisplayFoldsEntry(failed, display)).toBe(false);
    expect(chatDisplayRemovesEntry(failed, display)).toBe(false);
  });

  it("removes hidden calls under Remove, except ones whose image still shows", () => {
    const display = custom({ hidden: "remove" });
    expect(chatDisplayRemovesEntry(typecheck, display)).toBe(true);
    expect(chatDisplayRemovesEntry(image, display)).toBe(false);
    expect(chatDisplayRemovesEntry(image, custom({ hidden: "remove", images: "click" }))).toBe(
      true,
    );
  });

  it("passes Show all and Zen through as upstream values", () => {
    expect(timelineToolCallVisibility("hideAll", null)).toBe("hideAll");
    expect(timelineToolCallVisibility("hideAll", custom({ mode: "zen" }))).toBe("zen");
    expect(typeof timelineToolCallVisibility("showAll", custom({ mode: "hideAll" }))).toBe(
      "object",
    );
  });

  it("summarizes a fold by kind", () => {
    expect(chatDisplayHiddenSummary([ls, typecheck, typecheck], custom())).toBe(
      "3 hidden · 1 read, 2 commands",
    );
  });
});

describe("resolveChatDisplay", () => {
  const settings = (mode: ChatDisplaySettings["mode"]) => custom({ mode });
  it("prefers the project, then the environment, then all projects", () => {
    const store = {
      all: settings("hideAll"),
      environments: { devbox: settings("zen") },
      projects: { [chatDisplayProjectKey("devbox", "t3code")]: settings("custom") },
    };
    expect(resolveChatDisplay(store, "devbox", "t3code").mode).toBe("custom");
    expect(resolveChatDisplay(store, "devbox", "other").mode).toBe("zen");
    expect(resolveChatDisplay(store, "mac", "t3code").mode).toBe("hideAll");
    expect(resolveChatDisplay({ environments: {}, projects: {} }, "mac", null)).toBe(
      DEFAULT_CHAT_DISPLAY_SETTINGS,
    );
  });
});
