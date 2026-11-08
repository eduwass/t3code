// T3 Space fork: every Paper frame the thread has a screenshot of, for the viewer's rail.
import {
  paperShotsFromProjectedItems,
  type PaperShot,
} from "@t3tools/client-runtime/work-log/paper-tools";
import { createContext } from "react";

import type { TimelineEntry } from "../../session-logic";

export const PaperThreadShotsCtx = createContext<ReadonlyArray<PaperShot>>([]);

/** Newest capture first; frames with no known time go last. */
export function paperThreadShots(entries: ReadonlyArray<TimelineEntry>): ReadonlyArray<PaperShot> {
  const shots = paperShotsFromProjectedItems(
    entries.map((entry) => (entry.kind === "work" ? entry.entry.projectedItem : undefined)),
  );
  return shots.toSorted((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0));
}
