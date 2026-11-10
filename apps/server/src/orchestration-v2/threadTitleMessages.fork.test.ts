import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { threadTitleMessages } from "./threadTitleMessages.fork.ts";

const message = (text: string, at: number, extra: object = {}) =>
  ({
    text,
    role: "user",
    streaming: false,
    createdBy: "user",
    createdAt: DateTime.makeUnsafe(at),
    ...extra,
  }) as unknown as OrchestrationV2ConversationMessage;

describe("threadTitleMessages", () => {
  it("keeps what the person typed, in time order", () => {
    const result = threadTitleMessages([
      message("later", 3),
      message("subagent report", 2, { createdBy: "agent" }),
      message("/compact", 4, { idleCompaction: {} }),
      message("answer", 1, { role: "assistant", createdBy: "agent" }),
      message("partial", 5, { role: "assistant", streaming: true }),
      message("first", 0),
    ]);
    expect(result.map((item) => item.text)).toEqual(["first", "answer", "later"]);
  });

  it("keeps only the latest ten user messages and what follows them", () => {
    const result = threadTitleMessages(
      Array.from({ length: 12 }, (_, index) => message(`user ${index}`, index)),
    );
    expect(result.map((item) => item.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `user ${index + 2}`),
    );
  });
});
