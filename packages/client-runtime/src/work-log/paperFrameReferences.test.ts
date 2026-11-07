import { describe, expect, it } from "vite-plus/test";

import type { PaperShot } from "./paperTools.ts";
import {
  buildPaperFrameMenuItems,
  paperFrameMentionMarkdown,
  withPaperFrameRecords,
} from "./paperFrameReferences.ts";

const mention = (nodeId: string, name: string) =>
  paperFrameMentionMarkdown({ fileId: "01M50M7KR7", nodeId, name, shot: null, inThread: false })!;

describe("withPaperFrameRecords", () => {
  it("sends one record per referenced frame, keeping existing records", () => {
    const text = `make ${mention("1BFZ-2", "Chat column")} match ${mention("1-0", "Home · phone")} and ${mention("1BFZ-2", "Chat column")}`;
    const existing = withPaperFrameRecords(undefined, mention("9-0", "Earlier"));
    const context = withPaperFrameRecords(existing, text);
    expect(context?.records.map((record) => [record.kind, record.contextId, record.label])).toEqual(
      [
        ["paper-frame", "01M50M7KR7_9-0", "Earlier"],
        ["paper-frame", "01M50M7KR7_1BFZ-2", "Chat column"],
        ["paper-frame", "01M50M7KR7_1-0", "Home · phone"],
      ],
    );
    expect(context?.records[1]).toMatchObject({
      payload: {
        fileId: "01M50M7KR7",
        nodeId: "1BFZ-2",
        url: "https://app.paper.design/file/01M50M7KR7?node=1BFZ-2",
      },
    });
  });

  it("leaves the context alone when no frame is referenced", () => {
    expect(withPaperFrameRecords(undefined, "plain text")).toBeUndefined();
  });
});

describe("buildPaperFrameMenuItems", () => {
  const shot = (nodeId: string) =>
    ({ key: `F1/${nodeId}`, fileId: "F1", nodeId }) as unknown as PaperShot;
  const files = [
    {
      _tag: "listFrames" as const,
      fileName: "App",
      frames: [
        { fileId: "F1", nodeId: "1-0", name: "Home", width: 390, height: 844 },
        { fileId: "F1", nodeId: "2-0", name: "Settings", width: 390, height: 844 },
      ],
    },
  ];

  it("lists thread frames first, named from the file, without repeating them", () => {
    const items = buildPaperFrameMenuItems({
      shots: [shot("2-0")],
      files,
      shotNames: null,
      query: "",
    });
    expect(items.map((item) => [item.label, item.description])).toEqual([
      ["Settings", "Paper · drawn in this thread"],
      ["Home", "Paper · App"],
    ]);
  });

  it("filters by name", () => {
    const items = buildPaperFrameMenuItems({ shots: [], files, shotNames: null, query: "hom" });
    expect(items.map((item) => item.label)).toEqual(["Home"]);
  });
});
