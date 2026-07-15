/**
 * ClaudeTranscriptReplay - convert a recorded Claude Code session transcript
 * (the on-disk `~/.claude/projects/<cwd>/<sessionId>.jsonl` log) into the SAME
 * canonical `ProviderRuntimeEvent`s that the live `ClaudeAdapter` emits.
 *
 * The events are published through `ProviderService.replayRuntimeEvents`, so
 * they flow through the existing ingestion → projection → renderer pipeline
 * untouched: assistant text, reasoning, tool calls and their outputs render
 * with the same fidelity as a session T3 itself drove. This is the "reuse the
 * SDK→T3 converter, but feed it from the file" path — only the producer below
 * is new; everything downstream is shared with the live stream.
 *
 * Human prompts are NOT runtime events (live T3 records them via the send-turn
 * command), so they are returned separately as `userPrompts` for the caller to
 * backfill. Final render order is timestamp-driven downstream, so the two may
 * interleave freely.
 *
 * @module ClaudeTranscriptReplay
 */
import {
  EventId,
  type IsoDateTime,
  ProviderDriverKind,
  ProviderItemId,
  RuntimeItemId,
  type ThreadId,
  TurnId,
  type CanonicalItemType,
  type ProviderRuntimeEvent,
  type RuntimeContentStreamKind,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import { classifyToolItemType, titleForTool } from "../provider/Layers/ClaudeAdapter.ts";

const PROVIDER = ProviderDriverKind.make("claudeAgent");
const EPOCH_ISO = "1970-01-01T00:00:00.000Z" as IsoDateTime;

/**
 * A reference to an image embedded in the transcript. The importer resolves the
 * actual bytes: prefer the original on-disk file (`sourcePath`, higher fidelity)
 * and fall back to the inline base64 the transcript also carries.
 */
export interface ReplayImageRef {
  readonly sourcePath?: string;
  readonly base64?: string;
  readonly mimeType: string;
}

/**
 * A recorded conversational message to backfill. BOTH user prompts and
 * assistant text go through history backfill (a direct, idempotent dispatch),
 * not the runtime-event bus — the bus buffers assistant deltas and flushes them
 * only on turn/request boundaries, which is unreliable for an incremental sync.
 * Tool calls and reasoning still flow as runtime events (they render as
 * activities, which dispatch directly).
 */
export interface ReplayMessage {
  /** Source transcript line uuid — stable, unique id for idempotent backfill. */
  readonly uuid: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: IsoDateTime;
  readonly images: ReadonlyArray<ReplayImageRef>;
}

export interface ClaudeTranscriptReplay {
  readonly events: ReadonlyArray<ProviderRuntimeEvent>;
  readonly messages: ReadonlyArray<ReplayMessage>;
}

/** Minimal view of a transcript line (`~/.claude/.../<id>.jsonl`). */
interface TranscriptLine {
  readonly type?: unknown;
  readonly uuid?: unknown;
  readonly timestamp?: unknown;
  readonly message?: { readonly role?: unknown; readonly content?: unknown } | undefined;
}

interface ContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly thinking?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
  readonly input?: unknown;
  readonly tool_use_id?: unknown;
  readonly content?: unknown;
  readonly is_error?: unknown;
  readonly source?: unknown;
}

// `[Image: source: /abs/path.png]` — Claude writes the original file path as a
// standalone text block alongside the inline base64 image block.
const IMAGE_PLACEHOLDER_RE = /^\[Image: source: (.+)\]$/;
// `[Image #3]` — inline marker Claude injects into the human prompt text.
const IMAGE_TOKEN_RE = /\[Image #\d+\]/g;

function mimeFromExtension(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/**
 * Extract a human prompt's text and image references from a user message. Image
 * placeholder paths win over inline base64 (original quality); inline base64 is
 * the fallback when no path block is present (older transcript format).
 */
function extractHumanContent(message: TranscriptLine["message"]): {
  readonly text: string;
  readonly images: ReadonlyArray<ReplayImageRef>;
} {
  const content = message?.content;
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };

  const paths: string[] = [];
  const base64s: Array<{ data: string; mimeType: string }> = [];
  const textParts: string[] = [];
  for (const block of content as ReadonlyArray<ContentBlock>) {
    const type = asString(block.type);
    if (type === "image") {
      const src = block.source as
        | { type?: unknown; media_type?: unknown; data?: unknown }
        | undefined;
      const data = asString(src?.data);
      if (src && asString(src.type) === "base64" && data) {
        base64s.push({ data, mimeType: asString(src.media_type) ?? "image/png" });
      }
    } else if (type === "text") {
      const text = asString(block.text) ?? "";
      const placeholder = text.match(IMAGE_PLACEHOLDER_RE);
      if (placeholder?.[1]) {
        paths.push(placeholder[1]);
        continue;
      }
      const cleaned = text.replace(IMAGE_TOKEN_RE, "").trim();
      if (cleaned.length > 0) textParts.push(cleaned);
    }
  }

  // Pair the Nth placeholder path with the Nth inline base64 block into one
  // ref carrying both sources. The importer prefers the original on-disk file
  // but falls back to base64 when the image-cache has been pruned — neither
  // alone is reliable (cache files get deleted; base64 isn't always present).
  const count = Math.max(paths.length, base64s.length);
  const images: Array<ReplayImageRef> = [];
  for (let i = 0; i < count; i += 1) {
    const p = paths[i];
    const b = base64s[i];
    if (!p && !b) continue;
    images.push({
      ...(p ? { sourcePath: p } : {}),
      ...(b ? { base64: b.data } : {}),
      mimeType: p ? mimeFromExtension(p) : (b?.mimeType ?? "image/png"),
    });
  }
  return { text: textParts.join("\n\n"), images };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Harness-injected synthetic "user" turns: background-task notifications,
 * system reminders and local-command echoes that the agent runtime records as
 * user messages. They open with a recognizable wrapper tag and are not human
 * prompts, so they are excluded from the imported conversation.
 */
const SYNTHETIC_USER_PREFIXES = [
  "<task-notification>",
  "<system-reminder>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
] as const;

function isSyntheticUserPrompt(text: string): boolean {
  return SYNTHETIC_USER_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function asBlocks(message: TranscriptLine["message"]): ReadonlyArray<ContentBlock> {
  const content = message?.content;
  return Array.isArray(content) ? (content as ReadonlyArray<ContentBlock>) : [];
}

/**
 * Flatten a `tool_result.content` (string, or array of text/image blocks) into
 * a single output string, noting any image blocks so screenshots are at least
 * surfaced even before native image rendering lands.
 */
function flattenToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  let images = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const candidate = block as ContentBlock;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      parts.push(candidate.text);
    } else if (candidate.type === "image") {
      images += 1;
    }
  }
  if (images > 0) {
    parts.push(`\n[${images} image${images === 1 ? "" : "s"} in tool output]`);
  }
  return parts.join("");
}

function outputStreamKind(itemType: CanonicalItemType): RuntimeContentStreamKind {
  return itemType === "command_execution"
    ? "command_output"
    : itemType === "file_change"
      ? "file_change_output"
      : "unknown";
}

/**
 * Parse transcript lines into canonical runtime events + human prompts.
 *
 * Walks lines in recorded order. A new turn opens at each human prompt. For
 * each assistant burst we emit: turn.started → content.delta (assistant_text /
 * reasoning_text) and item.started per tool_use → on the following tool_result,
 * content.delta (command_output / file_change_output) + item.completed →
 * turn.completed when the burst closes.
 */
export const claudeTranscriptToReplay = Effect.fn("claudeTranscriptToReplay")(function* (input: {
  readonly lines: ReadonlyArray<unknown>;
  readonly threadId: ThreadId;
}): Effect.fn.Return<ClaudeTranscriptReplay, never, Crypto.Crypto> {
  const crypto = yield* Crypto.Crypto;
  // `randomUUIDv4` can technically fail with a PlatformError; a uuid generator
  // failing is not a recoverable condition for a transcript parse, so treat it
  // as a defect and keep this producer's error channel clean.
  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const { threadId } = input;

  const events: ProviderRuntimeEvent[] = [];
  const messages: ReplayMessage[] = [];
  const toolItemTypeById = new Map<string, CanonicalItemType>();

  let currentTurnId: TurnId | undefined;
  let turnOpen = false;
  let lastCreatedAt: IsoDateTime = EPOCH_ISO;
  // Timestamp of the last assistant-side event in the current turn. The turn is
  // completed at THIS time (when the model stopped), not at the next human
  // prompt — otherwise idle time between turns inflates the "Worked for …".
  let turnLastActivityAt: IsoDateTime = EPOCH_ISO;

  const baseEvent = (createdAt: IsoDateTime) =>
    Effect.map(uuid, (id) => ({
      eventId: EventId.make(id),
      provider: PROVIDER,
      threadId,
      createdAt,
      ...(currentTurnId ? { turnId: currentTurnId } : {}),
    }));

  const openTurn = (createdAt: IsoDateTime) =>
    Effect.gen(function* () {
      if (turnOpen) return;
      currentTurnId = TurnId.make(yield* uuid);
      turnOpen = true;
      turnLastActivityAt = createdAt;
      const base = yield* baseEvent(createdAt);
      events.push({
        ...base,
        type: "turn.started",
        payload: {},
        raw: { source: "claude.sdk.message", method: "claude/replay/turn-start", payload: {} },
      } as ProviderRuntimeEvent);
    });

  // Completes at the last assistant-side activity time, not "now"/next prompt.
  const closeTurn = () =>
    Effect.gen(function* () {
      if (!turnOpen) return;
      const base = yield* baseEvent(turnLastActivityAt);
      events.push({
        ...base,
        type: "turn.completed",
        payload: { state: "completed" },
        raw: { source: "claude.sdk.message", method: "claude/replay/turn-complete", payload: {} },
      } as ProviderRuntimeEvent);
      turnOpen = false;
      currentTurnId = undefined;
    });

  const pushContentDelta = (
    createdAt: IsoDateTime,
    itemId: string,
    streamKind: RuntimeContentStreamKind,
    delta: string,
  ) =>
    Effect.gen(function* () {
      if (delta.length === 0) return;
      turnLastActivityAt = createdAt;
      const base = yield* baseEvent(createdAt);
      events.push({
        ...base,
        type: "content.delta",
        itemId: RuntimeItemId.make(itemId),
        payload: { streamKind, delta },
        providerRefs: { providerItemId: ProviderItemId.make(itemId) },
      } as ProviderRuntimeEvent);
    });

  for (const rawLine of input.lines) {
    if (!rawLine || typeof rawLine !== "object") continue;
    const line = rawLine as TranscriptLine;
    const lineType = asString(line.type);
    // Lines without a timestamp (summary/system rows) inherit the last real
    // one — never EPOCH — so synthesized turn boundaries can't span 1970→now
    // and blow up the rendered "Worked for …" duration.
    const ts = asString(line.timestamp);
    const createdAt = (ts ?? lastCreatedAt) as IsoDateTime;
    if (ts) lastCreatedAt = createdAt;
    const blocks = asBlocks(line.message);
    const messageUuid = asString(line.uuid) ?? (yield* uuid);

    if (lineType === "user") {
      const toolResults = blocks.filter((b) => b.type === "tool_result");
      for (const block of toolResults) {
        const toolUseId = asString(block.tool_use_id);
        if (!toolUseId) continue;
        const itemType = toolItemTypeById.get(toolUseId) ?? "dynamic_tool_call";
        const isError = block.is_error === true;
        const output = flattenToolResultContent(block.content);
        const streamKind = outputStreamKind(itemType);
        if (output.length > 0 && streamKind !== "unknown") {
          yield* pushContentDelta(createdAt, toolUseId, streamKind, output);
        }
        turnLastActivityAt = createdAt;
        const base = yield* baseEvent(createdAt);
        events.push({
          ...base,
          type: "item.completed",
          itemId: RuntimeItemId.make(toolUseId),
          payload: {
            itemType,
            status: isError ? "failed" : "completed",
            title: titleForTool(itemType),
            ...(output.length > 0 ? { detail: output } : {}),
            data: { ...(output.length > 0 ? { output } : {}), isError },
          },
          providerRefs: { providerItemId: ProviderItemId.make(toolUseId) },
          raw: {
            source: "claude.sdk.message",
            method: "claude/replay/tool-result",
            payload: block,
          },
        } as ProviderRuntimeEvent);
      }

      // Tool-result lines are not human prompts; only mine prompt text/images
      // from non-tool-result user messages.
      const human =
        toolResults.length === 0
          ? extractHumanContent(line.message)
          : { text: "", images: [] as ReadonlyArray<ReplayImageRef> };
      const trimmedPrompt = human.text.trim();
      // Any user-role message (real prompt OR harness-injected synthetic one)
      // ends the assistant's burst, so it closes the open turn — otherwise two
      // bursts separated only by a synthetic notification merge into one turn
      // whose duration spans the idle gap between them. Synthetic turns
      // (task-notifications, system reminders, local-command echoes) still are
      // NOT backfilled as prompts; they'd render as noise bubbles.
      const isUserMessage = trimmedPrompt.length > 0 || human.images.length > 0;
      if (isUserMessage) {
        yield* closeTurn();
        if (!isSyntheticUserPrompt(trimmedPrompt)) {
          messages.push({
            uuid: messageUuid,
            role: "user",
            text: trimmedPrompt,
            createdAt,
            images: human.images,
          });
        }
      }
      continue;
    }

    if (lineType === "assistant") {
      yield* openTurn(createdAt);
      const assistantTextParts: string[] = [];
      let blockIndex = 0;
      for (const block of blocks) {
        const blockType = asString(block.type);
        if (blockType === "text") {
          // Assistant text is backfilled as a message (reliable, idempotent),
          // NOT a runtime delta (which the ingestion buffers unreliably). One
          // message per assistant line; blocks joined so they don't glue.
          const text = asString(block.text);
          if (text) assistantTextParts.push(text);
        } else if (blockType === "thinking") {
          yield* pushContentDelta(
            createdAt,
            `${messageUuid}:thinking:${blockIndex}`,
            "reasoning_text",
            asString(block.thinking) ?? "",
          );
        } else if (blockType === "tool_use") {
          const toolUseId = asString(block.id) ?? `${messageUuid}:tool:${blockIndex}`;
          const toolName = asString(block.name) ?? "tool";
          const itemType = classifyToolItemType(toolName);
          toolItemTypeById.set(toolUseId, itemType);
          turnLastActivityAt = createdAt;
          const base = yield* baseEvent(createdAt);
          events.push({
            ...base,
            type: "item.started",
            itemId: RuntimeItemId.make(toolUseId),
            payload: {
              itemType,
              status: "inProgress",
              title: titleForTool(itemType),
              data: {
                toolName,
                input:
                  block.input && typeof block.input === "object"
                    ? (block.input as Record<string, unknown>)
                    : {},
              },
            },
            providerRefs: { providerItemId: ProviderItemId.make(toolUseId) },
            raw: { source: "claude.sdk.message", method: "claude/replay/tool-use", payload: block },
          } as ProviderRuntimeEvent);
        }
        blockIndex += 1;
      }
      if (assistantTextParts.length > 0) {
        messages.push({
          uuid: messageUuid,
          role: "assistant",
          text: assistantTextParts.join("\n\n"),
          createdAt,
          images: [],
        });
      }
    }
    // Other line types (system, summary, attachment, queue-operation,
    // last-prompt) carry no renderable conversation content — skip them.
  }

  yield* closeTurn();

  // Settle the imported thread: an external session has no live provider, so
  // it must not render as a running session. session.exited clears any active
  // turn and sets status to "stopped" — no perpetual "Working …" spinner or
  // stop button. (A mid-stream turn whose completion was rejected by the
  // active-turn conflict guard would otherwise pin the session "running".)
  {
    const eventId = EventId.make(yield* uuid);
    events.push({
      type: "session.exited",
      eventId,
      provider: PROVIDER,
      threadId,
      createdAt: lastCreatedAt,
      payload: { exitKind: "graceful" },
      raw: { source: "claude.sdk.message", method: "claude/replay/session-exit", payload: {} },
    } as ProviderRuntimeEvent);
  }

  return { events, messages };
});
