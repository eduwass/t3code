// T3 Space fork: the open thread's Paper frames, one per frame, merged from the feed rows.
import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";

/** Newest capture first, one entry per frame; frames with no known time go last. */
export function paperThreadShots(rows: ReadonlyArray<object>): ReadonlyArray<PaperShot> {
  const byKey = new Map<string, PaperShot>();
  for (const row of rows) {
    const shots =
      "paperShots" in row ? (row.paperShots as ReadonlyArray<PaperShot> | undefined) : undefined;
    for (const shot of shots ?? []) {
      const existing = byKey.get(shot.key);
      if (existing === undefined || (shot.capturedAt ?? 0) > (existing.capturedAt ?? 0)) {
        byKey.set(shot.key, shot);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0));
}
