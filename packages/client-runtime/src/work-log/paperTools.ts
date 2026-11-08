import type {
  AssetResource,
  OrchestrationV2ProjectedTurnItem,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

// T3 Space fork. Paper MCP calls arrive as `mcp__paper__<tool>` from Claude and
// `paper.<tool>` from Codex.
const PAPER_TOOL_NAME = /^(?:mcp__paper__|paper\.)([a-z_]+)$/;

export function paperToolName(toolName: string | null | undefined): string | null {
  return toolName ? (PAPER_TOOL_NAME.exec(toolName)?.[1] ?? null) : null;
}

export interface PaperToolCall {
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly toolName: string | null | undefined;
  readonly status: string;
  readonly input: unknown;
  /** Epoch ms the call finished, when known. */
  readonly completedAt?: number | null;
}

export interface PaperShot {
  readonly key: string;
  readonly fileId: string;
  readonly nodeId: string;
  readonly url: string;
  readonly image: Extract<AssetResource, { readonly _tag: "tool-output-image" }>;
  /** When the agent last captured the frame (epoch ms). Paper has no per-frame edit time. */
  readonly capturedAt: number | null;
}

function stringField(input: unknown, field: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Paper selects the node and zooms to fit it when the file opens with `?node=`. */
export function paperNodeUrl(fileId: string, nodeId: string): string {
  return `https://app.paper.design/file/${encodeURIComponent(fileId)}?node=${encodeURIComponent(nodeId)}`;
}

/**
 * The frames the agent screenshotted, newest image per frame, in the order the
 * frames first appeared. Paper's screenshot result holds one image, so its
 * stored tool-output image is index 0.
 */
export function paperShots(calls: Iterable<PaperToolCall>): ReadonlyArray<PaperShot> {
  const shots = new Map<string, PaperShot>();
  for (const call of calls) {
    if (call.status !== "completed" || paperToolName(call.toolName) !== "get_screenshot") continue;
    const fileId = stringField(call.input, "fileId");
    const nodeId = stringField(call.input, "nodeId");
    if (fileId === null || nodeId === null) continue;
    const key = `${fileId}/${nodeId}`;
    const existing = shots.get(key);
    const shot: PaperShot = {
      key,
      fileId,
      nodeId,
      url: paperNodeUrl(fileId, nodeId),
      image: {
        _tag: "tool-output-image",
        threadId: call.threadId,
        itemId: call.itemId,
        index: 0,
      },
      capturedAt: call.completedAt ?? null,
    };
    // Re-setting an existing key keeps its first position in the Map.
    shots.set(
      key,
      existing === undefined
        ? shot
        : { ...existing, image: shot.image, capturedAt: shot.capturedAt ?? existing.capturedAt },
    );
  }
  return [...shots.values()];
}

/** Uses the source thread and item, which is where a delegated thread's image is stored. */
export function paperShotsFromProjectedItems(
  rows: Iterable<OrchestrationV2ProjectedTurnItem | undefined>,
): ReadonlyArray<PaperShot> {
  const calls: PaperToolCall[] = [];
  for (const row of rows) {
    if (row?.item.type !== "dynamic_tool" || paperToolName(row.item.toolName) === null) continue;
    const finishedAt = row.item.completedAt ?? row.item.updatedAt;
    calls.push({
      threadId: row.sourceThreadId,
      itemId: row.sourceItemId,
      toolName: row.item.toolName,
      status: row.item.status,
      input: row.item.input,
      completedAt: finishedAt ? DateTime.toEpochMillis(finishedAt) : null,
    });
  }
  return paperShots(calls);
}

/** Cheap identity for memo checks on rows that carry shots. */
export function paperShotsKey(shots: ReadonlyArray<PaperShot> | undefined): string {
  return shots?.map((shot) => `${shot.key}@${shot.image.itemId}`).join("|") ?? "";
}
