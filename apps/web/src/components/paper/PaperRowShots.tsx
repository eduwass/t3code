// T3 Space fork: thumbnails of the Paper frames the agent screenshotted, shown
// on the tool-call group so they stay visible while the calls are folded.
import {
  paperShotsFromProjectedItems,
  type PaperActivity,
  type PaperShot,
} from "@t3tools/client-runtime/work-log/paper-tools";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { type ReactNode, use, useState } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { ChatMarkdownAssetImage } from "../chat/ChatMarkdownMedia";
import { type TimelineRow, TimelineRowCtx } from "../chat/timelineRowContext";
import { PaperFrameViewer, PaperLivePrefetch } from "./PaperFrameViewer";
import { PaperRain } from "./PaperRain";
import {
  PaperThreadActivityCtx,
  PaperThreadShotsCtx,
  PaperViewerOpenCtx,
  type PaperViewerTarget,
  usePaperDrawing,
  usePaperDrawingKey,
  usePaperThumbnail,
} from "./paperThreadShots";

export function PaperRowShots({ row }: { row: TimelineRow }) {
  // An expanded group renders its header row and its content row; show the shots once.
  if (row.kind === "work-toggle" || row.kind === "turn-fold") {
    return <PaperShotsStrip shots={row.paperShots} />;
  }
  // One shape for live and finished rows, so a viewer opened mid-turn stays open when it ends.
  if (row.kind === "work-live" || (row.kind === "work" && !row.isExpandedToolGroup)) {
    return (
      <>
        {row.kind === "work-live" ? <PaperDrawingLine /> : null}
        <PaperShotsForEntries entries={row.groupedEntries} />
      </>
    );
  }
  return null;
}

/** On the running turn's tool row while the agent holds an artboard in Paper. */
function PaperDrawingLine() {
  const drawing = usePaperDrawing(use(TimelineRowCtx).activeThreadEnvironmentId);
  if (!drawing) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
      <PaperRain />
      <span>Drawing in Paper</span>
    </div>
  );
}

function PaperShotsForEntries({
  entries,
}: {
  entries: Extract<TimelineRow, { kind: "work" }>["groupedEntries"];
}) {
  const shots = paperShotsFromProjectedItems(entries.map((entry) => entry.projectedItem));
  return <PaperShotsStrip shots={shots} />;
}

function PaperShotsStrip({ shots }: { shots: ReadonlyArray<PaperShot> | undefined }) {
  const ctx = use(TimelineRowCtx);
  const environmentId = ctx.activeThreadEnvironmentId;
  const { enabled, liveEnabled } = useEnvironmentSettings(environmentId, (settings) => ({
    enabled: settings.paperIntegrationEnabled,
    liveEnabled: settings.paperLiveFramesEnabled,
  }));
  const drawingKey = usePaperDrawingKey(environmentId);
  const openViewer = use(PaperViewerOpenCtx);
  const setViewing = (target: { key: string; live: boolean }) =>
    openViewer({ ...target, shots: shots ?? [] });
  const visible = enabled && shots !== undefined && shots.length > 0;
  // Names need the server to reach Paper; without it the strip still works, unnamed.
  const names = useEnvironmentQuery(
    visible
      ? serverEnvironment.paper({
          environmentId,
          input: {
            _tag: "frameNames",
            frames: shots.slice(0, 64).map(({ fileId, nodeId }) => ({ fileId, nodeId })),
          },
        })
      : null,
  );
  if (!visible) return null;
  const nameOf = (shot: PaperShot) =>
    names.data?._tag === "frameNames"
      ? (names.data.frames.find(
          (frame) => frame.nodeId === shot.nodeId && frame.fileId === shot.fileId,
        )?.name ?? null)
      : null;
  return (
    <div className="mt-1.5 flex gap-2 overflow-x-auto rounded-lg bg-muted/40 p-2">
      {shots.map((shot) => (
        <figure
          key={shot.key}
          className="relative flex shrink-0 flex-col gap-1"
          onContextMenu={(event) => {
            event.preventDefault();
            setViewing({ key: shot.key, live: true });
          }}
        >
          {liveEnabled ? <PaperLivePrefetch environmentId={environmentId} shot={shot} /> : null}
          {shot.key === drawingKey ? (
            <span className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex rounded-md bg-black/75 px-1.5 py-1">
              <PaperRain />
            </span>
          ) : null}
          <ShotImage
            environmentId={environmentId}
            shot={shot}
            alt={nameOf(shot) ?? `Paper frame ${shot.nodeId}`}
            onExpand={() => setViewing({ key: shot.key, live: liveEnabled })}
          />
          <figcaption className="min-w-0 text-xs" style={CAPTION_STYLE}>
            <a
              href={shot.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${nameOf(shot) ?? "this frame"} in Paper`}
              className="inline-flex max-w-full items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <PaperIcon />
              <span className="truncate">{nameOf(shot) ?? "Paper frame"}</span>
            </a>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function ShotImage(props: {
  environmentId: EnvironmentId;
  shot: PaperShot;
  alt: string;
  onExpand: () => void;
}) {
  return (
    <ChatMarkdownAssetImage
      environmentId={props.environmentId}
      resource={usePaperThumbnail(props.environmentId, props.shot)}
      alt={props.alt}
      style={SHOT_IMAGE_STYLE}
      onImageExpand={props.onExpand}
    />
  );
}

/** The thread's Paper state for every row, and the one frame viewer the rows open. */
export function PaperThreadScope(props: {
  readonly environmentId: EnvironmentId;
  readonly shots: ReadonlyArray<PaperShot>;
  readonly activity: PaperActivity;
  readonly children: ReactNode;
}) {
  const [viewing, setViewing] = useState<PaperViewerTarget | null>(null);
  return (
    <PaperThreadShotsCtx value={props.shots}>
      <PaperThreadActivityCtx value={props.activity}>
        <PaperViewerOpenCtx value={setViewing}>
          {props.children}
          {viewing !== null ? (
            <PaperFrameViewer
              environmentId={props.environmentId}
              // The thread's frames, unless the strip had one the thread list has not caught up on.
              shots={
                props.shots.some((shot) => shot.key === viewing.key) ? props.shots : viewing.shots
              }
              initialKey={viewing.key}
              live={viewing.live}
              onClose={() => setViewing(null)}
            />
          ) : null}
        </PaperViewerOpenCtx>
      </PaperThreadActivityCtx>
    </PaperThreadShotsCtx>
  );
}

// Height-led sizing; the asset's authored width would make each figure as wide as the full image.
const SHOT_IMAGE_STYLE = { height: "11rem", width: "auto", maxWidth: "20rem" } as const;
const CAPTION_STYLE = { maxWidth: "20rem" } as const;

const PAPER_ICON_URL = faviconUrlForOrigin("https://paper.design");

function PaperIcon() {
  const [failed, setFailed] = useState(false);
  if (PAPER_ICON_URL === null || failed) return null;
  return (
    <img
      src={PAPER_ICON_URL}
      alt=""
      aria-hidden
      loading="lazy"
      draggable={false}
      className="size-3.5 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}
