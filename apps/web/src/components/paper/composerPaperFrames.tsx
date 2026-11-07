// T3 Space fork: Paper frames in the composer's @ menu. A picked frame becomes a
// `paper-frame` context reference whose id encodes the file and node, so the chip,
// its hover card and the record sent to the agent all rebuild from the reference.
import {
  paperShotsFromProjectedItems,
  paperNodeUrl,
  type PaperShot,
} from "@t3tools/client-runtime/work-log/paper-tools";
import type { AssetResource, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { ArrowUpRightIcon, FrameIcon } from "lucide-react";
import { useState, type ReactElement } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useThreadVisibleTurnItems } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import {
  parseContextId,
  type PaperFrameMention,
  type PaperFrameMenuItem,
} from "@t3tools/client-runtime/work-log/paper-frame-references";

export { PAPER_FRAME_CONTEXT_KIND } from "@t3tools/client-runtime/work-log/paper-frame-references";

const MAX_MENU_ITEMS = 8;

/** Frames from this thread's Paper work: drawn here first, then the rest of those files. */
export function usePaperFrameMenuItems(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ScopedThreadRef["threadId"] | null;
  readonly query: string | null;
}): ReadonlyArray<PaperFrameMenuItem> {
  const enabled = useEnvironmentSettings(
    input.environmentId,
    (settings) => settings.paperIntegrationEnabled,
  );
  const active = enabled && input.query !== null && input.threadId !== null;
  const items = useThreadVisibleTurnItems(
    active && input.threadId !== null
      ? { environmentId: input.environmentId, threadId: input.threadId }
      : null,
  );
  const shots = [...paperShotsFromProjectedItems(items)].reverse();
  const fileIds = [...new Set(shots.map((shot) => shot.fileId))];
  const listFrames = (fileId: string | undefined) =>
    active && fileId !== undefined
      ? serverEnvironment.paper({
          environmentId: input.environmentId,
          input: { _tag: "listFrames", fileId },
        })
      : null;
  const firstFile = useEnvironmentQuery(listFrames(fileIds[0]));
  const secondFile = useEnvironmentQuery(listFrames(fileIds[1]));
  const shotNames = useEnvironmentQuery(
    active && shots.length > 0
      ? serverEnvironment.paper({
          environmentId: input.environmentId,
          input: {
            _tag: "frameNames",
            frames: shots.slice(0, 64).map(({ fileId, nodeId }) => ({ fileId, nodeId })),
          },
        })
      : null,
  );
  if (!active) return [];

  const names = new Map<string, string | null>();
  const fileNames = new Map<string, string | null>();
  const fileFrames: PaperFrameMention[] = [];
  for (const result of [firstFile.data, secondFile.data]) {
    if (result?._tag !== "listFrames") continue;
    for (const frame of result.frames) {
      names.set(`${frame.fileId}/${frame.nodeId}`, frame.name);
      fileNames.set(frame.fileId, result.fileName);
      fileFrames.push({
        fileId: frame.fileId,
        nodeId: frame.nodeId,
        name: frame.name,
        shot: null,
        inThread: false,
      });
    }
  }
  if (shotNames.data?._tag === "frameNames") {
    for (const frame of shotNames.data.frames) {
      if (frame.name !== null) names.set(`${frame.fileId}/${frame.nodeId}`, frame.name);
    }
  }
  const threadFrames: PaperFrameMention[] = shots.map((shot) => ({
    fileId: shot.fileId,
    nodeId: shot.nodeId,
    name: names.get(shot.key) ?? null,
    shot,
    inThread: true,
  }));
  const inThread = new Set(shots.map((shot) => shot.key));
  const query = (input.query ?? "").trim().toLowerCase();
  return [
    ...threadFrames,
    ...fileFrames.filter((frame) => !inThread.has(`${frame.fileId}/${frame.nodeId}`)),
  ]
    .filter((frame) => query === "" || (frame.name ?? frame.nodeId).toLowerCase().includes(query))
    .slice(0, MAX_MENU_ITEMS)
    .map((frame) => ({
      id: `paper-frame:${frame.fileId}/${frame.nodeId}`,
      type: "paper-frame" as const,
      frame,
      label: frame.name ?? `Frame ${frame.nodeId}`,
      description: frame.inThread
        ? "Paper · drawn in this thread"
        : `Paper · ${fileNames.get(frame.fileId) ?? "in the file"}`,
    }));
}

/** The thread's screenshot when there is one, otherwise a small one fetched from Paper. */
function useFrameThumbnail(
  environmentId: EnvironmentId | null,
  frame: { fileId: string; nodeId: string; shot: PaperShot | null },
): string | null {
  const fetched = useEnvironmentQuery(
    environmentId !== null && frame.shot === null
      ? serverEnvironment.paper({
          environmentId,
          input: { _tag: "frameImage", fileId: frame.fileId, nodeId: frame.nodeId },
        })
      : null,
  );
  const resource: AssetResource | null =
    frame.shot !== null
      ? frame.shot.image
      : fetched.data?._tag === "frameImage"
        ? { _tag: "attachment", attachmentId: fetched.data.attachmentId, disposition: "inline" }
        : null;
  const url = useAssetUrlState(environmentId, resource);
  return url._tag === "Success" ? url.url : null;
}

function useRouteEnvironmentId(): EnvironmentId | null {
  const target = resolveThreadRouteTarget(useParams({ strict: false }));
  return target?.kind === "server" ? target.threadRef.environmentId : null;
}

function FramePreview(props: { name: string; url: string | null; fileId: string; nodeId: string }) {
  return (
    <div className="flex w-72 flex-col gap-2 p-2">
      <div className="flex h-44 items-center justify-center overflow-hidden rounded-md bg-muted/60">
        {props.url !== null ? (
          <img src={props.url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <FrameIcon className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-0.5 text-xs">
        <span className="min-w-0 truncate font-medium">{props.name}</span>
        <a
          href={paperNodeUrl(props.fileId, props.nodeId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground hover:text-foreground"
        >
          Open in Paper
          <ArrowUpRightIcon className="size-3" aria-hidden />
        </a>
      </div>
    </div>
  );
}

/** Thumbnail in an @ menu row; the highlighted row also shows it big beside the menu. */
export function PaperFrameMenuThumb(props: { item: PaperFrameMenuItem; active: boolean }) {
  const environmentId = useRouteEnvironmentId();
  const url = useFrameThumbnail(environmentId, props.item.frame);
  // Anchored to the small thumbnail, so push the card past the row to sit beside the menu.
  const [offset, setOffset] = useState(16);
  const measure = (element: HTMLSpanElement | null) => {
    const row = element?.closest("[data-composer-item-id]");
    if (!element || !row) return;
    setOffset(
      Math.max(16, row.getBoundingClientRect().right - element.getBoundingClientRect().right + 12),
    );
  };
  const thumb = (
    <span
      ref={props.active ? measure : undefined}
      className="flex h-6 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted"
    >
      {url !== null ? (
        <img src={url} alt="" className="size-full object-cover object-top" />
      ) : (
        <FrameIcon className="size-3.5 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
  return (
    <PreviewCard open={props.active}>
      <PreviewCardTrigger render={thumb} />
      <PreviewCardPopup side="right" align="start" sideOffset={offset}>
        <FramePreview
          name={props.item.label}
          url={url}
          fileId={props.item.frame.fileId}
          nodeId={props.item.frame.nodeId}
        />
      </PreviewCardPopup>
    </PreviewCard>
  );
}

/** The inline chip, in the composer and in sent messages; hover shows the frame. */
export function PaperFrameContextChip(props: { contextId: string; label: string }): ReactElement {
  const environmentId = useRouteEnvironmentId();
  const frame = parseContextId(props.contextId);
  const url = useFrameThumbnail(
    frame === null ? null : environmentId,
    frame === null ? { fileId: "", nodeId: "", shot: null } : { ...frame, shot: null },
  );
  const chip = (
    <ContextChip kind="image" tabIndex={0} aria-label={`Paper frame, ${props.label}`}>
      <FrameIcon aria-hidden />
      <ContextChipLabel>{props.label}</ContextChipLabel>
    </ContextChip>
  );
  if (frame === null) return chip;
  return (
    <PreviewCard>
      <PreviewCardTrigger render={chip} delay={150} />
      <PreviewCardPopup>
        <FramePreview name={props.label} url={url} fileId={frame.fileId} nodeId={frame.nodeId} />
      </PreviewCardPopup>
    </PreviewCard>
  );
}
