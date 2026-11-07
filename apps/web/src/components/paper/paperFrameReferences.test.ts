import { describe, expect, it } from "vite-plus/test";

import { paperFrameMentionMarkdown, withPaperFrameRecords } from "./paperFrameReferences";

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
