import { describe, expect, it } from "vite-plus/test";
import { ThreadId, TurnItemId } from "@t3tools/contracts";

import { paperNodeUrl, paperShots, paperToolName, type PaperToolCall } from "./paperTools.ts";

const threadId = ThreadId.make("thread-1");
const call = (
  itemId: string,
  toolName: string,
  input: unknown,
  status = "completed",
): PaperToolCall => ({ threadId, itemId: TurnItemId.make(itemId), toolName, status, input });

describe("paperToolName", () => {
  it.each([
    ["mcp__paper__get_screenshot", "get_screenshot"],
    ["paper.write_html", "write_html"],
    ["mcp__paperless__get_screenshot", null],
    ["mcp__t3-code__preview_open", null],
    [null, null],
  ])("%s -> %s", (toolName, expected) => {
    expect(paperToolName(toolName)).toBe(expected);
  });
});

describe("paperShots", () => {
  it("keeps the newest screenshot per frame in first-seen order and skips other calls", () => {
    const shots = paperShots([
      call("a", "mcp__paper__get_screenshot", { fileId: "F", nodeId: "1-0" }),
      call("b", "mcp__paper__write_html", { fileId: "F", targetNodeId: "1-0" }),
      call("c", "paper.get_screenshot", { fileId: "F", nodeId: "2-0" }),
      call("d", "mcp__paper__get_screenshot", { fileId: "F", nodeId: "1-0", scale: 0.5 }),
      call("e", "mcp__paper__get_screenshot", { fileId: "F", nodeId: "3-0" }, "failed"),
      call("f", "mcp__paper__get_screenshot", { summary: "too big", truncated: true }),
    ]);
    expect(shots.map((shot) => [shot.nodeId, shot.image.itemId])).toEqual([
      ["1-0", "d"],
      ["2-0", "c"],
    ]);
    expect(shots[0]?.image).toEqual({
      _tag: "tool-output-image",
      threadId,
      itemId: "d",
      index: 0,
    });
  });
});

describe("paperNodeUrl", () => {
  it("links the file with the node to focus", () => {
    expect(paperNodeUrl("01M6", "18F-0")).toBe("https://app.paper.design/file/01M6?node=18F-0");
  });
});
