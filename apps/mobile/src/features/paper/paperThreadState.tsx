// T3 Space fork: the open thread's Paper frames and what the agent is doing in Paper
// right now. The feed reports them; the strip and the app-root viewer read the result.
import { useAtomValue } from "@effect/atom-react";
import {
  paperActivityFromProjectedItems,
  paperDrawingInRun,
  paperDrawingKey,
  paperLiveRevision,
  type PaperActivity,
  type PaperShot,
} from "@t3tools/client-runtime/work-log/paper-tools";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import type { PaperViewerFrame } from "./paperFrameViewerState";
import { paperThreadShots } from "./paperThreadShots";

interface PaperThreadState {
  readonly shots: ReadonlyArray<PaperShot>;
  readonly activity: PaperActivity | null;
  /** The running run is the one holding an artboard in Paper. */
  readonly working: boolean;
}

const paperThreadStateAtom = Atom.make<PaperThreadState>({
  shots: [],
  activity: null,
  working: false,
}).pipe(Atom.keepAlive);

/** The frames of the thread on screen, read when a strip opens the viewer. */
export function currentPaperThreadShots(): ReadonlyArray<PaperShot> {
  return appAtomRegistry.get(paperThreadStateAtom).shots;
}

export function PaperThreadShotsSync(props: {
  readonly rows: ReadonlyArray<object>;
  /** The feed before folding, so a folded turn's writes still count. */
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  /** The thread's running run, if any. */
  readonly runId: string | null;
}) {
  const shots = paperThreadShots(props.rows);
  const activity = paperActivityFromProjectedItems(
    props.feed.flatMap((entry) =>
      entry.type === "activity-group" ? entry.activities.map((a) => a.projectedItem) : [],
    ),
  );
  const working = paperDrawingInRun(activity, props.runId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the feed's frames to the viewer, which opens from an app-root modal
  useEffect(() => {
    appAtomRegistry.set(paperThreadStateAtom, { shots, activity, working });
  }, [shots, activity, working]);
  return null;
}

function usePaperFlags(environmentId: EnvironmentId) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  return {
    indicator:
      settings?.paperIntegrationEnabled === true && settings.paperWorkingIndicatorEnabled === true,
    follow: settings?.paperLiveFramesEnabled === true && settings.paperLiveUpdatesEnabled === true,
  };
}

/** The frame the agent is drawing right now, when the working indicator is on. */
export function usePaperDrawingKey(environmentId: EnvironmentId): string | null {
  const state = useAtomValue(paperThreadStateAtom);
  const { indicator } = usePaperFlags(environmentId);
  return indicator && state.working && state.activity !== null
    ? paperDrawingKey(state.shots, state.activity)
    : null;
}

/** Which drawing a viewer frame shows; later writes count when following edits is on. */
export function usePaperFrameRevision(
  environmentId: EnvironmentId,
  frame: PaperViewerFrame,
): string | null {
  const state = useAtomValue(paperThreadStateAtom);
  const { follow } = usePaperFlags(environmentId);
  const shot = state.shots.find((candidate) => candidate.key === frame.key);
  return follow && shot !== undefined
    ? paperLiveRevision(shot, state.shots, state.activity)
    : frame.revision;
}

/**
 * A newer small screenshot from Paper once the agent wrote to the frame after the picture
 * named `base`. The last one stays up while the next one loads.
 */
export function usePaperFreshImage(
  environmentId: EnvironmentId,
  frame: { readonly fileId: string; readonly nodeId: string },
  base: string | null,
  revision: string | null,
): Extract<AssetResource, { readonly _tag: "attachment" }> | null {
  const later = revision !== null && revision !== base;
  const fetched = useEnvironmentQuery(
    later
      ? serverEnvironment.paper({
          environmentId,
          input: { _tag: "frameImage", fileId: frame.fileId, nodeId: frame.nodeId, revision },
        })
      : null,
  );
  const [latest, setLatest] = useState<{ base: string | null; attachmentId: string } | null>(null);
  const attachmentId = fetched.data?._tag === "frameImage" ? fetched.data.attachmentId : null;
  if (later && attachmentId !== null && attachmentId !== latest?.attachmentId) {
    setLatest({ base, attachmentId });
  }
  return latest !== null && latest.base === base
    ? { _tag: "attachment", attachmentId: latest.attachmentId, disposition: "inline" }
    : null;
}

/** A strip thumbnail: the agent's screenshot, or a newer one after later writes. */
export function usePaperShotThumbnail(
  environmentId: EnvironmentId,
  shot: PaperShot,
): PaperShot["image"] | Extract<AssetResource, { readonly _tag: "attachment" }> {
  const state = useAtomValue(paperThreadStateAtom);
  const { follow } = usePaperFlags(environmentId);
  const current = state.shots.find((candidate) => candidate.key === shot.key) ?? shot;
  const revision = follow ? paperLiveRevision(current, state.shots, state.activity) : null;
  return usePaperFreshImage(environmentId, shot, shot.image.itemId, revision) ?? shot.image;
}
