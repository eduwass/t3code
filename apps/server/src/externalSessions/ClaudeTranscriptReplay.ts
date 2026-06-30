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

/** A recorded human prompt to be backfilled as a user message. */
export interface ReplayUserPrompt {
  readonly text: string;
  readonly createdAt: IsoDateTime;
}

export interface ClaudeTranscriptReplay {
  readonly events: ReadonlyArray<ProviderRuntimeEvent>;
  readonly userPrompts: ReadonlyArray<ReplayUserPrompt>;
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
  const userPrompts: ReplayUserPrompt[] = [];
  const toolItemTypeById = new Map<string, CanonicalItemType>();

  let currentTurnId: TurnId | undefined;
  let turnOpen = false;
  let lastCreatedAt: IsoDateTime = EPOCH_ISO;

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
      const base = yield* baseEvent(createdAt);
      events.push({
        ...base,
        type: "turn.started",
        payload: {},
        raw: { source: "claude.sdk.message", method: "claude/replay/turn-start", payload: {} },
      } as ProviderRuntimeEvent);
    });

  const closeTurn = (createdAt: IsoDateTime) =>
    Effect.gen(function* () {
      if (!turnOpen) return;
      const base = yield* baseEvent(createdAt);
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

      const promptText =
        typeof line.message?.content === "string"
          ? line.message.content
          : toolResults.length === 0
            ? blocks
                .filter((b) => b.type === "text")
                .map((b) => asString(b.text) ?? "")
                .join("")
            : "";
      const trimmedPrompt = promptText.trim();
      // Skip harness-injected synthetic turns (background-task notifications,
      // system reminders, local-command echoes). They are recorded as user
      // messages but are not human prompts — backfilling them renders as noise
      // bubbles, and they must not close an assistant burst mid-turn.
      if (trimmedPrompt.length > 0 && !isSyntheticUserPrompt(trimmedPrompt)) {
        yield* closeTurn(createdAt);
        userPrompts.push({ text: trimmedPrompt, createdAt });
      }
      continue;
    }

    if (lineType === "assistant") {
      yield* openTurn(createdAt);
      let blockIndex = 0;
      for (const block of blocks) {
        const blockType = asString(block.type);
        if (blockType === "text") {
          yield* pushContentDelta(
            createdAt,
            `${messageUuid}:text`,
            "assistant_text",
            asString(block.text) ?? "",
          );
        } else if (blockType === "thinking") {
          yield* pushContentDelta(
            createdAt,
            `${messageUuid}:thinking`,
            "reasoning_text",
            asString(block.thinking) ?? "",
          );
        } else if (blockType === "tool_use") {
          const toolUseId = asString(block.id) ?? `${messageUuid}:tool:${blockIndex}`;
          const toolName = asString(block.name) ?? "tool";
          const itemType = classifyToolItemType(toolName);
          toolItemTypeById.set(toolUseId, itemType);
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
    }
    // Other line types (system, summary, attachment, queue-operation,
    // last-prompt) carry no renderable conversation content — skip them.
  }

  yield* closeTurn(lastCreatedAt);

  return { events, userPrompts };
});
