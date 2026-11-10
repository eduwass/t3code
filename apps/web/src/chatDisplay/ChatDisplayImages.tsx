// T3 Space fork: the images an agent looked at, shown without opening their rows.
import {
  resolveViewedImageAsset,
  workEntryViewedImagePath,
} from "@t3tools/client-runtime/work-log/presentation";
import { use } from "react";

import { ChatMarkdownAssetImage } from "../components/chat/ChatMarkdownMedia";
import { TimelineRowCtx } from "../components/chat/timelineRowContext";
import type { WorkLogEntry } from "../session-logic";
import { useChatDisplayContext } from "./chatDisplay";

const THUMBNAIL_REM = 5;
const FULL_REM = 16;

/** Image size the settings ask for on a row that is not open, or null for none. */
export function useChatDisplayImageRem(): number | null {
  const display = useChatDisplayContext();
  if (display === null || display.images === "click") return null;
  return display.images === "full" ? FULL_REM : THUMBNAIL_REM;
}

/** Under a folded group or turn, the images its hidden rows looked at. */
export function ChatDisplayImageStrip(props: {
  readonly entries: ReadonlyArray<WorkLogEntry> | undefined;
}) {
  const ctx = use(TimelineRowCtx);
  const rem = useChatDisplayImageRem();
  if (rem === null || !ctx.threadRef || !props.entries?.length) return null;
  const threadRef = ctx.threadRef;
  const images = props.entries.flatMap((entry) => {
    const path = workEntryViewedImagePath(entry);
    const asset = path
      ? resolveViewedImageAsset(path, {
          threadId: threadRef.threadId,
          workspaceRoot: ctx.workspaceRoot,
        })
      : null;
    return asset ? [{ id: entry.id, asset }] : [];
  });
  if (images.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {images.map(({ id, asset }) => (
        <ChatMarkdownAssetImage
          key={id}
          environmentId={threadRef.environmentId}
          resource={asset.resource}
          alt={asset.alt}
          srcFragment={asset.srcFragment}
          workspaceRoot={ctx.workspaceRoot}
          maxHeightRem={rem}
          onImageExpand={ctx.onImageExpand}
        />
      ))}
    </div>
  );
}
