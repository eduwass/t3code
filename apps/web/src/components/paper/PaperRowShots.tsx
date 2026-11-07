// T3 Space fork: thumbnails of the Paper frames the agent screenshotted, shown
// on the tool-call group so they stay visible while the calls are folded.
import {
  paperShotsFromProjectedItems,
  type PaperShot,
} from "@t3tools/client-runtime/work-log/paper-tools";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { ArrowUpRightIcon } from "lucide-react";
import { use, useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { ChatMarkdownAssetImage } from "../chat/ChatMarkdownMedia";
import { type TimelineRow, TimelineRowCtx } from "../chat/timelineRowContext";

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
  const enabled = useEnvironmentSettings(
    ctx.activeThreadEnvironmentId,
    (settings) => settings.paperIntegrationEnabled,
  );
  if (!enabled || shots === undefined || shots.length === 0) return null;
  return (
    <div className="mt-1.5 flex gap-2 overflow-x-auto rounded-lg bg-muted/40 p-2">
      {shots.map((shot) => (
        <figure key={shot.key} className="flex shrink-0 flex-col gap-1">
          <ChatMarkdownAssetImage
            environmentId={ctx.activeThreadEnvironmentId}
            resource={shot.image}
            alt={`Paper frame ${shot.nodeId}`}
            style={SHOT_IMAGE_STYLE}
            onImageExpand={ctx.onImageExpand}
          />
          <figcaption>
            <a
              href={shot.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            >
              <PaperIcon />
              Open in Paper
              <ArrowUpRightIcon className="size-3" aria-hidden />
            </a>
          </figcaption>
        </figure>
      ))}
    </div>
  );
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
