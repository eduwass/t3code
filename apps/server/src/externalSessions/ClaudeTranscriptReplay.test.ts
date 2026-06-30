import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { claudeTranscriptToReplay } from "./ClaudeTranscriptReplay.ts";

const threadId = ThreadId.make("00000000-0000-4000-8000-000000000000");

/** Loosely-typed view of an event payload for assertions. */
const payloadOf = (event: ProviderRuntimeEvent | undefined): Record<string, unknown> =>
  (event as unknown as { payload: Record<string, unknown> } | undefined)?.payload ?? {};

const LINES: ReadonlyArray<unknown> = [
  {
    type: "user",
    uuid: "u1",
    timestamp: "2024-01-01T00:00:00.000Z",
    message: { role: "user", content: "do the thing" },
  },
  {
    type: "assistant",
    uuid: "a1",
    timestamp: "2024-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "let me think" },
        { type: "text", text: "on it" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ],
    },
  },
  {
    type: "user",
    uuid: "u2",
    timestamp: "2024-01-01T00:00:02.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "file.txt", is_error: false }],
    },
  },
];

describe("claudeTranscriptToReplay", () => {
  it.layer(NodeServices.layer)("transcript replay", (it) => {
    it.effect("splits human prompts from assistant runtime events", () =>
      Effect.gen(function* () {
        const { userPrompts } = yield* claudeTranscriptToReplay({ lines: LINES, threadId });
        assert.equal(userPrompts.length, 1);
        assert.equal(userPrompts[0]!.text, "do the thing");
      }),
    );

    it.effect("maps assistant text, thinking, tool call + output to canonical events", () =>
      Effect.gen(function* () {
        const { events } = yield* claudeTranscriptToReplay({ lines: LINES, threadId });
        const types = new Set(events.map((e) => e.type));

        assert.isTrue(types.has("turn.started"), "opens a turn");
        assert.isTrue(types.has("turn.completed"), "closes the turn");
        assert.isTrue(types.has("item.started"), "tool call started");
        assert.isTrue(types.has("item.completed"), "tool call completed");

        // Bash classifies to command_execution and its output streams as command_output.
        const started = events.find((e) => e.type === "item.started");
        assert.equal(payloadOf(started).itemType, "command_execution");

        const output = events.find(
          (e) => e.type === "content.delta" && payloadOf(e).streamKind === "command_output",
        );
        assert.equal(payloadOf(output).delta, "file.txt");

        const completed = events.find((e) => e.type === "item.completed");
        assert.equal(payloadOf(completed).status, "completed");

        // Reasoning + assistant text both surface as content deltas.
        assert.isTrue(
          events.some(
            (e) => e.type === "content.delta" && payloadOf(e).streamKind === "reasoning_text",
          ),
          "thinking block becomes reasoning_text",
        );
        assert.isTrue(
          events.some(
            (e) => e.type === "content.delta" && payloadOf(e).streamKind === "assistant_text",
          ),
          "text block becomes assistant_text",
        );
      }),
    );

    it.effect("never stamps events at epoch when lines lack a timestamp", () =>
      Effect.gen(function* () {
        // Real Claude transcripts interleave timestamp-less rows (mode,
        // last-prompt, ai-title, file-history-snapshot). A trailing one used to
        // close the final turn at EPOCH, producing a 1970→now "Worked for …".
        const lines: ReadonlyArray<unknown> = [
          {
            type: "user",
            uuid: "u1",
            timestamp: "2026-06-30T17:31:30.000Z",
            message: { role: "user", content: "hi" },
          },
          {
            type: "assistant",
            uuid: "a1",
            timestamp: "2026-06-30T17:31:31.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "yo" }] },
          },
          // No-timestamp trailing rows — must not drag any event back to 1970.
          { type: "ai-title", uuid: "x1", message: { role: "assistant", content: [] } },
          { type: "last-prompt", uuid: "x2" },
        ];
        const { events } = yield* claudeTranscriptToReplay({ lines, threadId });
        const epochYear = "1970";
        for (const e of events) {
          assert.isFalse(
            String(e.createdAt).startsWith(epochYear),
            `event ${e.type} stamped at epoch (${e.createdAt})`,
          );
        }
      }),
    );

    it.effect("is empty for an empty transcript", () =>
      Effect.gen(function* () {
        const { events, userPrompts } = yield* claudeTranscriptToReplay({ lines: [], threadId });
        assert.equal(events.length, 0);
        assert.equal(userPrompts.length, 0);
      }),
    );
  });
});
