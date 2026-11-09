import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import { describe, expect, it } from "vite-plus/test";

import { paperThreadShots } from "./paperThreadShots";

const shot = (key: string, capturedAt: number | null, itemId = key): PaperShot =>
  ({ key, capturedAt, image: { itemId } }) as unknown as PaperShot;

describe("paperThreadShots", () => {
  it("keeps the newest capture per frame and lists frames newest first", () => {
    const shots = paperThreadShots([
      { paperShots: [shot("a", 100, "a1"), shot("b", 300)] },
      { type: "message" },
      { paperShots: [shot("a", 500, "a2"), shot("c", null)] },
    ]);
    expect(shots.map((s) => [s.key, s.image?.itemId])).toEqual([
      ["a", "a2"],
      ["b", "b"],
      ["c", "c"],
    ]);
  });
});
