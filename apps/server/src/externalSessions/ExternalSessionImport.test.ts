import { assert, describe, it } from "@effect/vitest";

import {
  deterministicThreadId,
  PROVIDER_MAP,
  SUPPORTED_EXTERNAL_PROVIDERS,
} from "./ExternalSessionImport.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicThreadId", () => {
  it("is stable for the same (driver, nativeId) — import is idempotent", () => {
    const a = deterministicThreadId("claudeAgent", "sess-1");
    const b = deterministicThreadId("claudeAgent", "sess-1");
    assert.strictEqual(a, b);
  });

  it("differs across sessions and across providers", () => {
    const claude1 = deterministicThreadId("claudeAgent", "sess-1");
    const claude2 = deterministicThreadId("claudeAgent", "sess-2");
    const opencode1 = deterministicThreadId("opencode", "sess-1");
    assert.notStrictEqual(claude1, claude2);
    assert.notStrictEqual(claude1, opencode1);
  });

  it("produces a valid v5-shaped UUID", () => {
    assert.match(deterministicThreadId("codex", "019f-abc"), UUID_RE);
  });
});

describe("PROVIDER_MAP resume cursors", () => {
  it("builds the native cursor shape each adapter consumes", () => {
    assert.deepStrictEqual(PROVIDER_MAP.claude!.resumeCursor("id-1"), { resume: "id-1" });
    assert.deepStrictEqual(PROVIDER_MAP.codex!.resumeCursor("id-1"), { threadId: "id-1" });
    assert.deepStrictEqual(PROVIDER_MAP.opencode!.resumeCursor("id-1"), { sessionId: "id-1" });
  });

  it("namespaces the agentsview id per provider", () => {
    assert.strictEqual(PROVIDER_MAP.claude!.agentsviewId("uuid"), "uuid");
    assert.strictEqual(PROVIDER_MAP.codex!.agentsviewId("uuid"), "codex:uuid");
    assert.strictEqual(PROVIDER_MAP.opencode!.agentsviewId("ses_x"), "opencode:ses_x");
  });

  it("exposes claude, codex and opencode as supported", () => {
    assert.deepStrictEqual([...SUPPORTED_EXTERNAL_PROVIDERS].sort(), [
      "claude",
      "codex",
      "opencode",
    ]);
  });
});
