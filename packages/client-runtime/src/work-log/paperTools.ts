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
  /** The run the call belongs to, when known. */
  readonly runId?: string | null;
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

/** Tools that change how a frame looks. */
const PAPER_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "write_html",
  "update_styles",
  "set_text_content",
  "delete_nodes",
  "duplicate_nodes",
  "move_nodes",
  "create_artboard",
  "create_tokens",
  "set_tokens",
]);

export interface PaperActivity {
  /** The agent wrote since it last called `finish_working_on_nodes`. */
  readonly holding: boolean;
  /** Nodes written since that release; often the artboard itself. */
  readonly targets: ReadonlyArray<string>;
  /** Nodes written at any point in the calls. */
  readonly written: ReadonlyArray<string>;
  /** The newest write, so a live frame knows to fetch the frame again. */
  readonly lastWrite: TurnItemId | null;
  /** The run of the newest write; a later run that never touched Paper is not drawing. */
  readonly lastWriteRunId: string | null;
}

function writeTargets(input: unknown): ReadonlyArray<string> {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  const ids: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.length > 0) ids.push(value);
    if (Array.isArray(value)) for (const entry of value) add(entry);
  };
  add(record.targetNodeId);
  add(record.nodeId);
  add(record.nodeIds);
  for (const list of [record.updates, record.nodes, record.moves]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry !== "object" || entry === null) continue;
      const fields = entry as Record<string, unknown>;
      add(fields.nodeId);
      add(fields.nodeIds);
      add(fields.id);
    }
  }
  return ids;
}

export function paperActivity(calls: Iterable<PaperToolCall>): PaperActivity {
  let holding = false;
  let lastWrite: TurnItemId | null = null;
  let lastWriteRunId: string | null = null;
  const targets = new Set<string>();
  const written = new Set<string>();
  for (const call of calls) {
    const tool = paperToolName(call.toolName);
    // ponytail: a release of some artboards ends the whole hold; agents almost always release all.
    if (tool === "finish_working_on_nodes") {
      holding = false;
      targets.clear();
      continue;
    }
    if (tool === null || !PAPER_WRITE_TOOLS.has(tool) || call.status === "failed") continue;
    holding = true;
    lastWrite = call.itemId;
    lastWriteRunId = call.runId ?? null;
    for (const id of writeTargets(call.input)) {
      targets.add(id);
      written.add(id);
    }
  }
  return { holding, targets: [...targets], written: [...written], lastWrite, lastWriteRunId };
}

function newestShot(shots: ReadonlyArray<PaperShot>): PaperShot | undefined {
  return shots.reduce<PaperShot | undefined>(
    (best, shot) =>
      best === undefined || (shot.capturedAt ?? 0) > (best.capturedAt ?? 0) ? shot : best,
    undefined,
  );
}

/** The agent holds an artboard in `runId`, the thread's running run. */
export function paperDrawingInRun(activity: PaperActivity | null, runId: string | null): boolean {
  if (activity === null || !activity.holding || runId === null) return false;
  return activity.lastWriteRunId === null || activity.lastWriteRunId === runId;
}

/**
 * The frame the agent is drawing: one it wrote to directly, else its newest capture.
 * Paper writes usually name a child node, and only Paper knows that node's artboard.
 */
export function paperDrawingKey(
  shots: ReadonlyArray<PaperShot>,
  activity: PaperActivity,
): string | null {
  if (!activity.holding) return null;
  return (
    (shots.find((shot) => activity.targets.includes(shot.nodeId)) ?? newestShot(shots))?.key ?? null
  );
}

/** Names the drawing a live frame shows; it changes on a new screenshot or a later write. */
export function paperLiveRevision(
  shot: PaperShot,
  shots: ReadonlyArray<PaperShot>,
  activity: PaperActivity | null,
): string {
  if (activity === null || activity.lastWrite === null) return shot.image.itemId;
  const touched = activity.written.includes(shot.nodeId) || newestShot(shots)?.key === shot.key;
  return touched ? `${shot.image.itemId}+${activity.lastWrite}` : shot.image.itemId;
}

function paperCallsFromProjectedItems(
  rows: Iterable<OrchestrationV2ProjectedTurnItem | undefined>,
): ReadonlyArray<PaperToolCall> {
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
      runId: row.item.runId ?? null,
    });
  }
  return calls;
}

/** Uses the source thread and item, which is where a delegated thread's image is stored. */
export function paperShotsFromProjectedItems(
  rows: Iterable<OrchestrationV2ProjectedTurnItem | undefined>,
): ReadonlyArray<PaperShot> {
  return paperShots(paperCallsFromProjectedItems(rows));
}

export function paperActivityFromProjectedItems(
  rows: Iterable<OrchestrationV2ProjectedTurnItem | undefined>,
): PaperActivity {
  return paperActivity(paperCallsFromProjectedItems(rows));
}

/** Cheap identity for memo checks on rows that carry shots. */
export function paperShotsKey(shots: ReadonlyArray<PaperShot> | undefined): string {
  return shots?.map((shot) => `${shot.key}@${shot.image.itemId}`).join("|") ?? "";
}
