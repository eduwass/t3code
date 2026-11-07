// T3 Space fork: Paper frame references in composer text, and the context records
// the agent receives for them. No React here, so send paths can import it cheaply.
import { paperNodeUrl, type PaperShot } from "./paperTools.ts";
import type {
  ComposerContextId,
  ComposerContextRecord,
  OrchestrationMessageContext,
  PaperResponse,
} from "@t3tools/contracts";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
} from "@t3tools/shared/composerContextReferences";

export const PAPER_FRAME_CONTEXT_KIND = "paper-frame";
const CONTEXT_ID = /^[a-z0-9-]{1,63}_[a-z0-9-]{1,63}$/i;

export interface PaperFrameMention {
  readonly fileId: string;
  readonly nodeId: string;
  readonly name: string | null;
  readonly shot: PaperShot | null;
  readonly inThread: boolean;
}

export interface PaperFrameMenuItem {
  readonly id: string;
  readonly type: "paper-frame";
  readonly frame: PaperFrameMention;
  readonly label: string;
  readonly description: string;
}

const MAX_MENU_ITEMS = 8;

/** The @ menu's frames: drawn in this thread first (newest first), then the rest of those files. */
export function buildPaperFrameMenuItems(input: {
  readonly shots: ReadonlyArray<PaperShot>;
  readonly files: ReadonlyArray<PaperResponse | null | undefined>;
  readonly shotNames: PaperResponse | null | undefined;
  readonly query: string;
}): ReadonlyArray<PaperFrameMenuItem> {
  const names = new Map<string, string | null>();
  const fileNames = new Map<string, string | null>();
  const fileFrames: PaperFrameMention[] = [];
  for (const result of input.files) {
    if (result?._tag !== "listFrames") continue;
    for (const frame of result.frames) {
      names.set(`${frame.fileId}/${frame.nodeId}`, frame.name);
      fileNames.set(frame.fileId, result.fileName);
      fileFrames.push({ ...frame, shot: null, inThread: false });
    }
  }
  if (input.shotNames?._tag === "frameNames") {
    for (const frame of input.shotNames.frames) {
      if (frame.name !== null) names.set(`${frame.fileId}/${frame.nodeId}`, frame.name);
    }
  }
  const inThread = new Set(input.shots.map((shot) => shot.key));
  const query = input.query.trim().toLowerCase();
  return [
    ...input.shots.map((shot) => ({
      fileId: shot.fileId,
      nodeId: shot.nodeId,
      name: names.get(shot.key) ?? null,
      shot,
      inThread: true,
    })),
    ...fileFrames.filter((frame) => !inThread.has(`${frame.fileId}/${frame.nodeId}`)),
  ]
    .filter((frame) => query === "" || (frame.name ?? frame.nodeId).toLowerCase().includes(query))
    .slice(0, MAX_MENU_ITEMS)
    .map((frame) => ({
      id: `paper-frame:${frame.fileId}/${frame.nodeId}`,
      type: "paper-frame" as const,
      frame: {
        fileId: frame.fileId,
        nodeId: frame.nodeId,
        name: frame.name,
        shot: frame.shot,
        inThread: frame.inThread,
      },
      label: frame.name ?? `Frame ${frame.nodeId}`,
      description: frame.inThread
        ? "Paper · drawn in this thread"
        : `Paper · ${fileNames.get(frame.fileId) ?? "in the file"}`,
    }));
}

const contextIdOf = (fileId: string, nodeId: string): ComposerContextId | null => {
  const id = `${fileId}_${nodeId}`;
  return CONTEXT_ID.test(id) ? (id as ComposerContextId) : null;
};

export const parseContextId = (contextId: string) => {
  const split = contextId.indexOf("_");
  return split <= 0
    ? null
    : { fileId: contextId.slice(0, split), nodeId: contextId.slice(split + 1) };
};

export function paperFrameMentionMarkdown(frame: PaperFrameMention): string | null {
  const record = paperFrameMentionRecord(frame);
  return record === null ? null : formatComposerContextReference(record);
}

/** The full record for a picked frame, for clients that keep records in the draft. */
export function paperFrameMentionRecord(frame: PaperFrameMention): ComposerContextRecord | null {
  const contextId = contextIdOf(frame.fileId, frame.nodeId);
  return contextId === null
    ? null
    : paperFrameRecord(contextId, frame.name ?? `Frame ${frame.nodeId}`);
}

function paperFrameRecord(
  contextId: ComposerContextId,
  label: string,
): ComposerContextRecord | null {
  const frame = parseContextId(contextId);
  if (frame === null) return null;
  return {
    version: 1,
    kind: PAPER_FRAME_CONTEXT_KIND,
    contextId,
    label,
    payload: {
      fileId: frame.fileId,
      nodeId: frame.nodeId,
      name: label,
      url: paperNodeUrl(frame.fileId, frame.nodeId),
      note: "A Paper design frame the user pointed at. Use the Paper MCP tools with this fileId and nodeId, for example get_screenshot or get_jsx.",
    },
  };
}

/** Adds a record for each Paper frame referenced in the text; the agent gets it as JSON. */
export function withPaperFrameRecords(
  context: OrchestrationMessageContext | undefined,
  text: string,
): OrchestrationMessageContext | undefined {
  const seen = new Set<string>();
  const records: ComposerContextRecord[] = [];
  for (const reference of collectComposerContextReferences(text)) {
    if (reference.kind !== PAPER_FRAME_CONTEXT_KIND || seen.has(reference.contextId)) continue;
    const record = paperFrameRecord(reference.contextId, reference.label);
    if (record === null) continue;
    seen.add(reference.contextId);
    records.push(record);
  }
  if (records.length === 0) return context;
  return { version: 1, records: [...(context?.records ?? []), ...records] };
}

/** The frame records alone, for callers that merge record lists themselves. */
export function paperFrameRecords(text: string): ReadonlyArray<ComposerContextRecord> {
  return withPaperFrameRecords(undefined, text)?.records ?? [];
}
