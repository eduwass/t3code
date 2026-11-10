import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

// A regenerated title names what the person is working on now, so only their latest messages count.
const RECENT_USER_MESSAGES = 10;

// Regenerating a title should follow what the person typed. Subagent reports, background-task
// notices and compaction requests arrive as user messages, and they are long enough to fill the
// title context and drown out the person's own recent messages.
export function threadTitleMessages(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): Array<OrchestrationV2ConversationMessage> {
  const typed = messages
    .filter(
      (message) =>
        !message.streaming &&
        (message.role !== "user" ||
          (message.createdBy === "user" && message.idleCompaction === undefined)),
    )
    .toSorted(
      (left, right) =>
        DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
    );
  const userIndexes = typed.flatMap((message, index) => (message.role === "user" ? [index] : []));
  return typed.slice(userIndexes.at(-RECENT_USER_MESSAGES) ?? 0);
}
