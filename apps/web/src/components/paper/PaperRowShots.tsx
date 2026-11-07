// T3 Space fork: thumbnails of the Paper frames the agent screenshotted, shown
// on the tool-call group so they stay visible while the calls are folded.
import {
  paperShotsFromProjectedItems,
  type PaperShot,
} from "@t3tools/client-runtime/work-log/paper-tools";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { ArrowUpRightIcon } from "lucide-react";
import { use, useState } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { ChatMarkdownAssetImage } from "../chat/ChatMarkdownMedia";
import { type TimelineRow, TimelineRowCtx } from "../chat/timelineRowContext";
import { PaperFrameViewer, usePaperLiveFrame } from "./PaperFrameViewer";

export function PaperRowShots({ row }: { row: TimelineRow }) {
  // An expanded group renders its header row and its content row; show the shots once.
  if (row.kind === "work-toggle") return <PaperShotsStrip shots={row.paperShots} />;
  if (row.kind === "work-live" || (row.kind === "work" && !row.isExpandedToolGroup)) {
    return <PaperShotsForEntries entries={row.groupedEntries} />;
  }
  return null;
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
  const [viewing, setViewing] = useState<{ shot: PaperShot; live: boolean } | null>(null);
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
          className="flex shrink-0 flex-col gap-1"
          onContextMenu={(event) => {
            event.preventDefault();
            setViewing({ shot, live: true });
          }}
        >
          {liveEnabled ? <PaperLivePrefetch environmentId={environmentId} shot={shot} /> : null}
          <ChatMarkdownAssetImage
            environmentId={environmentId}
            resource={shot.image}
            alt={nameOf(shot) ?? `Paper frame ${shot.nodeId}`}
            style={SHOT_IMAGE_STYLE}
            onImageExpand={(preview) =>
              liveEnabled ? setViewing({ shot, live: true }) : ctx.onImageExpand(preview)
            }
          />
          <figcaption className="flex min-w-0 items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-foreground/80">{nameOf(shot)}</span>
            <a
              href={shot.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <PaperIcon />
              Open in Paper
              <ArrowUpRightIcon className="size-3" aria-hidden />
            </a>
          </figcaption>
        </figure>
      ))}
      {viewing !== null ? (
        <PaperFrameViewer
          environmentId={environmentId}
          shot={viewing.shot}
          name={nameOf(viewing.shot)}
          live={viewing.live}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

/** Starts the live-frame request while the strip is on screen, so opening is instant. */
function PaperLivePrefetch(props: { environmentId: EnvironmentId; shot: PaperShot }) {
  usePaperLiveFrame(props.environmentId, props.shot, true);
  return null;
}

// Height-led sizing; the asset's authored width would make each figure as wide as the full image.
const SHOT_IMAGE_STYLE = { height: "11rem", width: "auto", maxWidth: "20rem" } as const;

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
