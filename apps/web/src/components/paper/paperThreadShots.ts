// T3 Space fork: every Paper frame the thread has a screenshot of, for the viewer's rail,
// and what the agent is doing in Paper right now.
import {
  paperActivityFromProjectedItems,
  paperDrawingInRun,
  paperDrawingKey,
  paperLiveRevision,
  paperShotsFromProjectedItems,
  type PaperActivity,
  type PaperShot,
} from "@t3tools/client-runtime/work-log/paper-tools";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { createContext, use, useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import type { TimelineEntry } from "../../session-logic";
import { TimelineRowActivityCtx } from "../chat/timelineRowContext";

export const PaperThreadShotsCtx = createContext<ReadonlyArray<PaperShot>>([]);
export const PaperThreadActivityCtx = createContext<PaperActivity | null>(null);

export interface PaperViewerTarget {
  readonly key: string;
  readonly live: boolean;
  /** The strip's own frames, for one the thread list has not caught up on yet. */
  readonly shots: ReadonlyArray<PaperShot>;
}
/** Opens the thread's one viewer, which lives above the chat list so rows can come and go. */
export const PaperViewerOpenCtx = createContext<(target: PaperViewerTarget) => void>(() => {});

const projectedItems = (entries: ReadonlyArray<TimelineEntry>) =>
  entries.map((entry) => (entry.kind === "work" ? entry.entry.projectedItem : undefined));

/** Newest capture first; frames with no known time go last. */
export function paperThreadShots(entries: ReadonlyArray<TimelineEntry>): ReadonlyArray<PaperShot> {
  const shots = paperShotsFromProjectedItems(projectedItems(entries));
  return shots.toSorted((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0));
}

export function paperThreadActivity(entries: ReadonlyArray<TimelineEntry>): PaperActivity {
  return paperActivityFromProjectedItems(projectedItems(entries));
}

/** The frame the agent is drawing right now, when the working indicator is on. */
export function usePaperDrawingKey(environmentId: EnvironmentId): string | null {
  const shots = use(PaperThreadShotsCtx);
  const activity = use(PaperThreadActivityCtx);
  const { isWorking, latestRunId } = use(TimelineRowActivityCtx);
  const enabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.paperIntegrationEnabled && settings.paperWorkingIndicatorEnabled,
  );
  return enabled && isWorking && paperDrawingInRun(activity, latestRunId)
    ? paperDrawingKey(shots, activity!)
    : null;
}

/** True while the agent holds an artboard in a running turn, when the indicator is on. */
export function usePaperDrawing(environmentId: EnvironmentId): boolean {
  const activity = use(PaperThreadActivityCtx);
  const { isWorking, latestRunId } = use(TimelineRowActivityCtx);
  const enabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.paperIntegrationEnabled && settings.paperWorkingIndicatorEnabled,
  );
  return enabled && isWorking && paperDrawingInRun(activity, latestRunId);
}

/** Which drawing a live frame should show; later writes count when following edits is on. */
export function usePaperLiveRevision(environmentId: EnvironmentId, shot: PaperShot): string {
  const shots = use(PaperThreadShotsCtx);
  const activity = use(PaperThreadActivityCtx);
  const follow = useEnvironmentSettings(
    environmentId,
    (settings) => settings.paperLiveFramesEnabled && settings.paperLiveUpdatesEnabled,
  );
  return follow ? paperLiveRevision(shot, shots, activity) : shot.image.itemId;
}

/**
 * The frame's picture: the agent's screenshot, or a newer one from Paper once the agent wrote
 * to it since. The last picture stays up while the next one loads.
 */
export function usePaperThumbnail(
  environmentId: EnvironmentId,
  shot: PaperShot,
): {
  readonly resource: PaperShot["image"] | Extract<AssetResource, { readonly _tag: "attachment" }>;
  /** Paper no longer has the frame; the last picture stays. */
  readonly deleted: boolean;
} {
  const revision = usePaperLiveRevision(environmentId, shot);
  const fresh = useEnvironmentQuery(
    revision === shot.image.itemId
      ? null
      : serverEnvironment.paper({
          environmentId,
          input: { _tag: "frameImage", fileId: shot.fileId, nodeId: shot.nodeId, revision },
        }),
  );
  const [latest, setLatest] = useState<{ base: string; attachmentId: string } | null>(null);
  const fetched = fresh.data?._tag === "frameImage" ? fresh.data.attachmentId : null;
  if (fetched !== null && fetched !== latest?.attachmentId) {
    setLatest({ base: shot.image.itemId, attachmentId: fetched });
  }
  // A newer screenshot from the agent replaces anything fetched for an older one.
  return {
    resource:
      latest !== null && latest.base === shot.image.itemId
        ? { _tag: "attachment", attachmentId: latest.attachmentId, disposition: "inline" }
        : shot.image,
    deleted: fresh.data?._tag === "frameDeleted",
  };
}
