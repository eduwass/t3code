// T3 Space fork: every Paper frame the open thread has a screenshot of, for the viewer's
// filmstrip and frame list. The feed reports its rows; a tapped strip reads the result.
import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { appAtomRegistry } from "../../state/atom-registry";

const paperThreadShotsAtom = Atom.make<ReadonlyArray<PaperShot>>([]).pipe(Atom.keepAlive);

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

/** The frames of the thread on screen, read when a strip opens the viewer. */
export function currentPaperThreadShots(): ReadonlyArray<PaperShot> {
  return appAtomRegistry.get(paperThreadShotsAtom);
}

export function PaperThreadShotsSync(props: { readonly rows: ReadonlyArray<object> }) {
  const shots = paperThreadShots(props.rows);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the feed's frames to the viewer, which opens from an app-root modal
  useEffect(() => {
    appAtomRegistry.set(paperThreadShotsAtom, shots);
  }, [shots]);
  return null;
}
