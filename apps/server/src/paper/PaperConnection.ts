// T3 Space fork: one long-lived MCP client to Paper, spoken over the stdio of a
// shell command (on a Linux box, usually `ssh <mac> "~/.paper/bin/paper mcp"`).
// MCP frames are JSON-RPC lines; replies are matched to requests by id.
// @effect-diagnostics globalJsonInEffect:off
import { PaperUnavailableError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Ndjson from "effect/encoding/Ndjson";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CONNECT_TIMEOUT = Duration.seconds(20);
const CALL_TIMEOUT = Duration.seconds(30);

type Reply = { readonly result?: unknown; readonly error?: unknown };

interface Live {
  readonly scope: Scope.Closeable;
  readonly send: (line: string) => Effect.Effect<void, PaperUnavailableError>;
  readonly pending: Map<number, Deferred.Deferred<Reply>>;
  readonly closed: Deferred.Deferred<void>;
}

const unreachable = (detail: string) =>
  new PaperUnavailableError({ reason: "unreachable", detail });

export interface PaperToolResult {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
  }>;
  readonly isError: boolean;
}

export const make = Effect.fn("PaperConnection.make")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const live = yield* Ref.make<Live | null>(null);
  const connectLock = yield* Semaphore.make(1);
  const nextId = yield* Ref.make(1);

  const request = Effect.fn("PaperConnection.request")(function* (
    connection: Live,
    method: string,
    params: unknown,
  ) {
    const id = yield* Ref.getAndUpdate(nextId, (n) => n + 1);
    const reply = yield* Deferred.make<Reply>();
    connection.pending.set(id, reply);
    yield* connection.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const settled = yield* Deferred.await(reply).pipe(
      Effect.raceFirst(
        Deferred.await(connection.closed).pipe(
          Effect.andThen(Effect.fail(unreachable("Paper's MCP process exited."))),
        ),
      ),
      Effect.timeoutOption(CALL_TIMEOUT),
      Effect.ensuring(Effect.sync(() => connection.pending.delete(id))),
    );
    if (settled._tag === "None") return yield* unreachable(`${method} timed out.`);
    if (settled.value.error !== undefined) {
      return yield* new PaperUnavailableError({
        reason: "failed",
        detail: JSON.stringify(settled.value.error).slice(0, 500),
      });
    }
    return settled.value.result;
  });

  const connect = Effect.fn("PaperConnection.connect")(function* (command: string) {
    const scope = yield* Scope.make();
    const opened = Effect.gen(function* () {
      const handle = yield* spawner
        .spawn(
          ChildProcess.make("sh", ["-c", command], {
            stdin: { stream: "pipe", endOnDone: false },
            stdout: "pipe",
            stderr: "pipe",
            killSignal: "SIGTERM",
            forceKillAfter: Duration.seconds(2),
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            unreachable(`Could not start the Paper command: ${String(cause)}`),
          ),
        );
      const pending = new Map<number, Deferred.Deferred<Reply>>();
      const closed = yield* Deferred.make<void>();
      const connection: Live = {
        scope,
        pending,
        closed,
        send: (line) =>
          Stream.run(Stream.encodeText(Stream.make(`${line}\n`)), handle.stdin).pipe(
            Effect.mapError(() => unreachable("Could not write to Paper's MCP process.")),
          ),
      };
      yield* handle.stdout.pipe(
        Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
        Stream.runForEach((message) =>
          Effect.sync(() => {
            if (typeof message !== "object" || message === null) return;
            const { id, result, error } = message as {
              id?: unknown;
              result?: unknown;
              error?: unknown;
            };
            if (typeof id !== "number") return;
            const reply = pending.get(id);
            if (reply) Deferred.doneUnsafe(reply, Exit.succeed({ result, error }));
          }),
        ),
        Effect.ignore,
        Effect.ensuring(Deferred.succeed(closed, undefined)),
        Effect.forkIn(scope),
      );
      yield* handle.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkIn(scope));
      yield* request(connection, "initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "t3-space", version: "1" },
      }).pipe(
        Effect.timeoutOption(CONNECT_TIMEOUT),
        Effect.flatMap((done) =>
          done._tag === "None" ? Effect.fail(unreachable("Paper did not answer.")) : Effect.void,
        ),
      );
      yield* connection.send(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      );
      return connection;
    }).pipe(Scope.provide(scope));
    return yield* opened.pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
  });

  const current = (command: string) =>
    connectLock.withPermits(1)(
      Effect.gen(function* () {
        const existing = yield* Ref.get(live);
        if (existing !== null && !(yield* Deferred.isDone(existing.closed))) return existing;
        if (existing !== null) yield* Scope.close(existing.scope, Exit.void);
        const connection = yield* connect(command);
        yield* Ref.set(live, connection);
        return connection;
      }),
    );

  const close = Effect.gen(function* () {
    const existing = yield* Ref.getAndSet(live, null);
    if (existing !== null) yield* Scope.close(existing.scope, Exit.void);
  });
  yield* Effect.addFinalizer(() => close);

  const callTool = Effect.fn("PaperConnection.callTool")(function* (
    command: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    const connection = yield* current(command);
    const result = yield* request(connection, "tools/call", { name, arguments: args });
    const value = (typeof result === "object" && result !== null ? result : {}) as {
      content?: unknown;
      isError?: unknown;
    };
    return {
      content: Array.isArray(value.content) ? value.content : [],
      isError: value.isError === true,
    } satisfies PaperToolResult;
  });

  return { callTool, close };
});
