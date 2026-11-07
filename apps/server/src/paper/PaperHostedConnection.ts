// T3 Space fork: Paper's hosted MCP over streamable HTTP, signed in with a Paper
// account. Same tools as Paper Desktop, but every call must name its file.
// Replies come back as JSON or as a short event stream whose last `data:` line is the reply.
// @effect-diagnostics globalJsonInEffect:off
import { PaperUnavailableError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/http";

import { PAPER_MCP_URL, type PaperAccount } from "./PaperAccount.ts";
import type { PaperToolResult } from "./PaperConnection.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CALL_TIMEOUT = Duration.seconds(30);

const unreachable = (detail: string) =>
  new PaperUnavailableError({ reason: "unreachable", detail });

/** The JSON-RPC message in a reply body, whether plain JSON or an event stream. */
export const replyMessage = (body: string): unknown => {
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  try {
    return JSON.parse(data.length > 0 ? (data.at(-1) ?? "") : body);
  } catch {
    return null;
  }
};

/** The MCP refused the token (401/403) or no longer knows the session (404). */
class PaperHostedRejected extends Schema.TaggedError<PaperHostedRejected>()("PaperHostedRejected", {
  status: Schema.Number,
}) {}

export const make = Effect.fn("PaperHostedConnection.make")(function* (account: PaperAccount) {
  const http = yield* HttpClient.HttpClient;
  const session = yield* Ref.make<string | null>(null);
  const connectLock = yield* Semaphore.make(1);
  const nextId = yield* Ref.make(1);

  const send = Effect.fn("PaperHostedConnection.send")(function* (
    token: string,
    sessionId: string | null,
    message: Record<string, unknown>,
  ) {
    const response = yield* http
      .execute(
        HttpClientRequest.post(PAPER_MCP_URL).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${token}`,
            accept: "application/json, text/event-stream",
            ...(sessionId === null ? {} : { "mcp-session-id": sessionId }),
          }),
          HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", ...message }),
        ),
      )
      .pipe(
        Effect.timeout(CALL_TIMEOUT),
        Effect.mapError((cause) => unreachable(`Paper's hosted MCP: ${String(cause)}`)),
      );
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return yield* new PaperHostedRejected({ status: response.status });
    }
    if (response.status >= 400) {
      return yield* unreachable(`Paper's hosted MCP answered ${response.status}.`);
    }
    const text = yield* response.text.pipe(
      Effect.mapError(() => unreachable("Paper's hosted MCP reply was cut off.")),
    );
    return {
      sessionId: response.headers["mcp-session-id"] ?? sessionId,
      message: replyMessage(text),
    };
  });

  const connect = (token: string) =>
    connectLock.withPermits(1)(
      Effect.gen(function* () {
        const existing = yield* Ref.get(session);
        if (existing !== null) return existing;
        const opened = yield* send(token, null, {
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "t3-space", version: "1" },
          },
        });
        yield* send(token, opened.sessionId, { method: "notifications/initialized" });
        yield* Ref.set(session, opened.sessionId);
        return opened.sessionId;
      }),
    );

  const attempt = Effect.fn("PaperHostedConnection.attempt")(function* (
    name: string,
    args: Record<string, unknown>,
  ) {
    const token = yield* account.token.pipe(
      Effect.mapError((error) => unreachable(`Paper account: ${error.detail}`)),
    );
    if (Option.isNone(token)) {
      return yield* new PaperUnavailableError({
        reason: "not-configured",
        detail: "No Paper account is signed in.",
      });
    }
    const sessionId = yield* connect(token.value);
    const id = yield* Ref.getAndUpdate(nextId, (n) => n + 1);
    return yield* send(token.value, sessionId, {
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
  });

  const callTool = Effect.fn("PaperHostedConnection.callTool")(function* (
    name: string,
    args: Record<string, unknown>,
  ) {
    // A refused token or a lapsed MCP session is retried once with a fresh one.
    const reply = yield* attempt(name, args).pipe(
      Effect.catchTags({
        PaperHostedRejected: Effect.fn("PaperHostedConnection.retry")(function* (error) {
          yield* Ref.set(session, null);
          if (error.status !== 404) yield* account.invalidate;
          return yield* attempt(name, args);
        }),
      }),
      Effect.catchTags({
        PaperHostedRejected: (error) =>
          Effect.fail(unreachable(`Paper's hosted MCP refused the account (${error.status}).`)),
      }),
    );
    const message = (
      typeof reply.message === "object" && reply.message !== null ? reply.message : {}
    ) as { result?: unknown; error?: unknown };
    if (message.error !== undefined) {
      return yield* new PaperUnavailableError({
        reason: "failed",
        detail: JSON.stringify(message.error).slice(0, 500),
      });
    }
    const value = (
      typeof message.result === "object" && message.result !== null ? message.result : {}
    ) as { content?: unknown; isError?: unknown };
    return {
      content: Array.isArray(value.content) ? value.content : [],
      isError: value.isError === true,
    } satisfies PaperToolResult;
  });

  const close = Ref.set(session, null);

  return { callTool, close };
});
