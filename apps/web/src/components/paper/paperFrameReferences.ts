// T3 Space fork: Paper frame references in composer text, and the context records
// the agent receives for them. No React here, so send paths can import it cheaply.
import { paperNodeUrl, type PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import type {
  ComposerContextId,
  ComposerContextRecord,
  OrchestrationMessageContext,
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
  const contextId = contextIdOf(frame.fileId, frame.nodeId);
  if (contextId === null) return null;
  return formatComposerContextReference({
    kind: PAPER_FRAME_CONTEXT_KIND,
    contextId,
    label: frame.name ?? `Frame ${frame.nodeId}`,
  });
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
    const frame = parseContextId(reference.contextId);
    if (frame === null) continue;
    seen.add(reference.contextId);
    records.push({
      version: 1,
      kind: PAPER_FRAME_CONTEXT_KIND,
      contextId: reference.contextId,
      label: reference.label,
      payload: {
        fileId: frame.fileId,
        nodeId: frame.nodeId,
        name: reference.label,
        url: paperNodeUrl(frame.fileId, frame.nodeId),
        note: "A Paper design frame the user pointed at. Use the Paper MCP tools with this fileId and nodeId, for example get_screenshot or get_jsx.",
      },
    });
  }
  if (records.length === 0) return context;
  return { version: 1, records: [...(context?.records ?? []), ...records] };
}

/** The frame records alone, for callers that merge record lists themselves. */
export function paperFrameRecords(text: string): ReadonlyArray<ComposerContextRecord> {
  return withPaperFrameRecords(undefined, text)?.records ?? [];
}
