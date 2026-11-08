import { describe, expect, it } from "vite-plus/test";
import { ThreadId, TurnItemId } from "@t3tools/contracts";

import {
  paperActivity,
  paperDrawingInRun,
  paperDrawingKey,
  paperLiveRevision,
  paperNodeUrl,
  paperShots,
  paperToolName,
  type PaperToolCall,
} from "./paperTools.ts";

const threadId = ThreadId.make("thread-1");
const call = (
  itemId: string,
  toolName: string,
  input: unknown,
  status = "completed",
  completedAt: number | null = null,
): PaperToolCall => ({
  threadId,
  itemId: TurnItemId.make(itemId),
  toolName,
  status,
  input,
  completedAt,
});

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
      call("a", "mcp__paper__get_screenshot", { fileId: "F", nodeId: "1-0" }, "completed", 100),
      call("b", "mcp__paper__write_html", { fileId: "F", targetNodeId: "1-0" }),
      call("c", "paper.get_screenshot", { fileId: "F", nodeId: "2-0" }),
      call(
        "d",
        "mcp__paper__get_screenshot",
        { fileId: "F", nodeId: "1-0", scale: 0.5 },
        "completed",
        300,
      ),
      call("e", "mcp__paper__get_screenshot", { fileId: "F", nodeId: "3-0" }, "failed"),
      call("f", "mcp__paper__get_screenshot", { summary: "too big", truncated: true }),
    ]);
    expect(shots.map((shot) => [shot.nodeId, shot.image.itemId, shot.capturedAt])).toEqual([
      ["1-0", "d", 300],
      ["2-0", "c", null],
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

describe("paperActivity", () => {
  const shoot = (itemId: string, nodeId: string, at: number) =>
    call(itemId, "mcp__paper__get_screenshot", { fileId: "F", nodeId }, "completed", at);
  const calls = [
    shoot("s1", "1-0", 100),
    shoot("s2", "2-0", 200),
    call("w1", "mcp__paper__write_html", { fileId: "F", targetNodeId: "1-0", html: "" }),
    call("w2", "paper.update_styles", { fileId: "F", updates: [{ nodeIds: ["9-9"] }] }),
  ];

  it("holds from the first write until finish_working_on_nodes", () => {
    const holding = paperActivity(calls);
    expect(holding).toMatchObject({ holding: true, lastWrite: "w2", targets: ["1-0", "9-9"] });
    const released = paperActivity([
      ...calls,
      call("f", "mcp__paper__finish_working_on_nodes", {}),
    ]);
    expect(released).toMatchObject({ holding: false, lastWrite: "w2", targets: [] });
    expect(paperActivity([shoot("s1", "1-0", 1)])).toMatchObject({
      holding: false,
      lastWrite: null,
    });
  });

  it("counts a hold only in the run that wrote, so a later run without Paper shows nothing", () => {
    const write = { ...calls[2]!, runId: "run-1" };
    expect(paperDrawingInRun(paperActivity([write]), "run-1")).toBe(true);
    expect(paperDrawingInRun(paperActivity([write]), "run-2")).toBe(false);
    expect(paperDrawingInRun(paperActivity([write]), null)).toBe(false);
  });

  it("marks the frame written to directly, else the newest capture", () => {
    const shots = paperShots(calls);
    expect(paperDrawingKey(shots, paperActivity(calls))).toBe("F/1-0");
    const elsewhere = paperActivity([calls[0]!, calls[1]!, calls[3]!]);
    expect(paperDrawingKey(shots, elsewhere)).toBe("F/2-0");
    expect(paperDrawingKey(shots, paperActivity([]))).toBeNull();
  });

  it("moves the live revision of written and newest frames only, and keeps it after release", () => {
    const shots = paperShots(calls);
    const released = paperActivity([
      ...calls,
      call("f", "mcp__paper__finish_working_on_nodes", {}),
    ]);
    const [first, second] = shots;
    expect(paperLiveRevision(first!, shots, released)).toBe("s1+w2");
    expect(paperLiveRevision(second!, shots, released)).toBe("s2+w2");
    const onlyFirst = paperActivity([calls[2]!]);
    const older = paperShots([
      shoot("s1", "1-0", 100),
      shoot("s3", "3-0", 50),
      shoot("s2", "2-0", 200),
    ]);
    expect(paperLiveRevision(older[1]!, older, onlyFirst)).toBe("s3");
    expect(paperLiveRevision(first!, shots, null)).toBe("s1");
  });
});
