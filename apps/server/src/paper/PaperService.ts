// T3 Space fork: what clients ask Paper for. Frame names, a file's frames, and
// a frame converted to standalone HTML ("live frame"). Behind the Paper Labs
// switch. Calls go through the user's ordered connections: Paper Desktop (from
// T3_PAPER_MCP_COMMAND or a local install) and a Paper account on the hosted MCP.
// @effect-diagnostics globalJsonInEffect:off
import {
  paperConnectionOrder,
  PaperUnavailableError,
  type PaperAccountRequest,
  type PaperAccountResponse,
  type PaperConnectionKind,
  type PaperConnectionStatus,
  type PaperFrame,
  type PaperRequest,
  type PaperResponse,
  type PaperSignInError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as PaperAccount from "./PaperAccount.ts";
import * as PaperConnection from "./PaperConnection.ts";
import * as PaperHostedConnection from "./PaperHostedConnection.ts";
import { paperJsxRootSize, paperJsxToHtml } from "./paperJsxToHtml.ts";

export class PaperService extends Context.Service<
  PaperService,
  {
    readonly request: (input: PaperRequest) => Effect.Effect<PaperResponse, PaperUnavailableError>;
    readonly account: (
      input: PaperAccountRequest,
    ) => Effect.Effect<PaperAccountResponse, PaperSignInError>;
  }
>()("t3/paper/PaperService") {}

const failed = (detail: string) => new PaperUnavailableError({ reason: "failed", detail });

/** Paper answers with a file header block, then the payload as the last text block. */
const payloadText = (result: PaperConnection.PaperToolResult) => {
  const texts = result.content.flatMap((block) =>
    typeof block.text === "string" ? [block.text] : [],
  );
  const text = texts.at(-1);
  if (result.isError || text === undefined) {
    return Effect.fail(failed(text?.slice(0, 300) ?? "Paper returned no content."));
  }
  return Effect.succeed(text);
};

const payloadJson = Effect.fn("PaperService.payloadJson")(function* (
  result: PaperConnection.PaperToolResult,
) {
  const text = yield* payloadText(result);
  return yield* Effect.try({
    try: () => JSON.parse(text) as Record<string, unknown>,
    catch: () => failed("Paper returned invalid JSON."),
  });
});

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown) => (typeof value === "string" ? value : null);
// Keys join ids with a character Paper ids never contain.
const key = (...parts: ReadonlyArray<string>) => parts.join("\u0000");
const split = (value: string) => value.split("\u0000") as [string, string, string?];
// A connection that could not be reached is skipped for this long, so falling back happens once.
const DOWN_FOR_MS = 30_000;

/** The machine an `ssh <host> …` command reaches, for labelling the Desktop connection. */
export const sshHost = (command: string): string | null => {
  const words = command.trim().split(/\s+/);
  const ssh = words.findIndex((word) => word === "ssh" || word.endsWith("/ssh"));
  if (ssh < 0) return null;
  for (let index = ssh + 1; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word.startsWith("-")) {
      if (/^-[bcDEeFIiJLlmOoPpRSWw]$/.test(word)) index += 1;
      continue;
    }
    return word.replace(/^.*@/, "").replace(/["']/g, "");
  }
  return null;
};

/** Enabled kinds in order, with ones that just failed moved to the end rather than dropped. */
export const attemptOrder = (
  order: ReadonlyArray<PaperConnectionKind>,
  health: ReadonlyMap<PaperConnectionKind, { readonly downUntil: number }>,
  now: number,
): ReadonlyArray<PaperConnectionKind> => {
  const isDown = (kind: PaperConnectionKind) => (health.get(kind)?.downUntil ?? 0) > now;
  return [...order.filter((kind) => !isDown(kind)), ...order.filter(isDown)];
};

const keepSuccesses = (ttl: Duration.Input) => (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? ttl : Duration.zero;
// A deleted frame is asked about again soon, so an undo in Paper shows up quickly.
const keepFrames = (ttl: Duration.Input) => (exit: Exit.Exit<PaperResponse, unknown>) =>
  Exit.isSuccess(exit)
    ? exit.value._tag === "frameDeleted"
      ? Duration.seconds(30)
      : ttl
    : Duration.zero;

/**
 * Paper still answers for a deleted frame, with an empty shell and no parent; once the file
 * reloads, the node is gone. `node` is the parsed `get_node_info` payload, or its error text.
 */
/** Paper names a node's artboard; an artboard itself has none. */
export const artboardOf = (node: Record<string, unknown>, nodeId: string) =>
  stringOrNull(node.artboardId) ?? nodeId;

export const isDeletedFrame = (node: Record<string, unknown> | string) =>
  typeof node === "string" ? node.startsWith("Node not found") : node.parentId === null;

const make = Effect.fn("PaperService.make")(function* () {
  const connection = yield* PaperConnection.make();
  const account = yield* PaperAccount.make();
  const hosted = yield* PaperHostedConnection.make(account);
  const settings = yield* ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configured = yield* Config.String("T3_PAPER_MCP_COMMAND").pipe(Config.option);
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));
  const localPaper = home === "" ? null : path.join(home, ".paper", "bin", "paper");

  /** The Desktop MCP command, or none when neither the variable nor a local install is there. */
  const desktopCommand = Effect.gen(function* () {
    if (Option.isSome(configured) && configured.value.trim() !== "") return configured.value;
    if (
      localPaper !== null &&
      (yield* fileSystem.exists(localPaper).pipe(Effect.orElseSucceed(() => false)))
    ) {
      return `"${localPaper}" mcp`;
    }
    return null;
  });

  const health = yield* Ref.make<
    ReadonlyMap<
      PaperConnectionKind,
      { readonly downUntil: number; readonly latencyMs: number | null }
    >
  >(new Map());

  const enabledOrder = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(Effect.option);
    if (Option.isNone(current) || !current.value.paperIntegrationEnabled) {
      yield* connection.close;
      yield* hosted.close;
      return yield* new PaperUnavailableError({
        reason: "disabled",
        detail: "Paper integration is off in Labs.",
      });
    }
    return paperConnectionOrder(current.value.paperConnections);
  });

  const callOn = (kind: PaperConnectionKind, name: string, args: Record<string, unknown>) =>
    kind === "account"
      ? hosted.callTool(name, args)
      : desktopCommand.pipe(
          Effect.flatMap((command) =>
            command === null
              ? Effect.fail(
                  new PaperUnavailableError({
                    reason: "not-configured",
                    detail: "Set T3_PAPER_MCP_COMMAND, or install Paper Desktop on this machine.",
                  }),
                )
              : connection.callTool(command, name, args),
          ),
        );

  const markHealth = (kind: PaperConnectionKind, downUntil: number, latencyMs: number | null) =>
    Ref.update(health, (current) => new Map(current).set(kind, { downUntil, latencyMs }));

  /** Tries the enabled connections in order; ones that just failed wait their turn at the end. */
  const call = Effect.fn("PaperService.call")(function* (
    name: string,
    args: Record<string, unknown>,
  ) {
    const order = (yield* enabledOrder).filter((entry) => entry.enabled).map((entry) => entry.kind);
    const now = yield* Clock.currentTimeMillis;
    const known = yield* Ref.get(health);
    let lastError = new PaperUnavailableError({
      reason: "not-configured",
      detail: "Turn on a Paper connection in Settings → Labs.",
    });
    for (const kind of attemptOrder(order, known, now)) {
      const started = yield* Clock.currentTimeMillis;
      const result = yield* Effect.result(callOn(kind, name, args));
      const finished = yield* Clock.currentTimeMillis;
      if (result._tag === "Success") {
        yield* markHealth(kind, 0, finished - started);
        return result.success;
      }
      lastError = result.failure;
      // Paper answered, so the next connection would answer the same.
      if (lastError.reason === "failed") return yield* lastError;
      if (lastError.reason === "unreachable") yield* markHealth(kind, finished + DOWN_FOR_MS, null);
    }
    return yield* lastError;
  });

  const connections = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(Effect.option);
    const order = paperConnectionOrder(
      Option.isSome(current) ? current.value.paperConnections : [],
    );
    const command = yield* desktopCommand;
    const email = yield* account.email;
    const now = yield* Clock.currentTimeMillis;
    const known = yield* Ref.get(health);
    let inUse = false;
    return order.map((entry): PaperConnectionStatus => {
      const available = entry.kind === "desktop" ? command !== null : Option.isSome(email);
      const label =
        entry.kind === "desktop"
          ? command === null
            ? null
            : (sshHost(command) ?? "this machine")
          : (Option.getOrNull(email) ?? null);
      const down = (known.get(entry.kind)?.downUntil ?? 0) > now;
      const state = !entry.enabled
        ? "off"
        : !available
          ? "missing"
          : down
            ? "down"
            : inUse
              ? "ready"
              : "in-use";
      if (state === "in-use") inUse = true;
      return {
        kind: entry.kind,
        enabled: entry.enabled,
        state,
        label,
        latencyMs: known.get(entry.kind)?.latencyMs ?? null,
      };
    });
  });

  const nodeInfo = yield* Cache.makeWith(
    Effect.fn("PaperService.nodeInfo")(function* (cacheKey: string) {
      const [fileId, nodeId] = split(cacheKey);
      const info = yield* payloadJson(yield* call("get_node_info", { fileId, nodeId }));
      return {
        fileId,
        nodeId,
        name: stringOrNull(info.name),
        width: numberOrNull(info.width),
        height: numberOrNull(info.height),
      } satisfies PaperFrame;
    }),
    { capacity: 1024, timeToLive: keepSuccesses(Duration.minutes(10)) },
  );

  // A node stays in its artboard, so the answer keeps.
  const artboards = yield* Cache.makeWith(
    Effect.fn("PaperService.artboardOf")(function* (cacheKey: string) {
      const [fileId, nodeId] = split(cacheKey);
      const info = yield* payloadJson(yield* call("get_node_info", { fileId, nodeId }));
      return { _tag: "artboardOf" as const, nodeId: artboardOf(info, nodeId) };
    }),
    { capacity: 1024, timeToLive: keepSuccesses(Duration.hours(1)) },
  );

  const fileFrames = yield* Cache.makeWith(
    Effect.fn("PaperService.fileFrames")(function* (fileId: string) {
      const info = yield* payloadJson(yield* call("get_basic_info", { fileId }));
      const artboards = Array.isArray(info.artboards) ? info.artboards : [];
      return {
        _tag: "listFrames" as const,
        fileName: stringOrNull(info.fileName),
        frames: artboards.flatMap((artboard: Record<string, unknown>) =>
          typeof artboard.id === "string"
            ? [
                {
                  fileId,
                  nodeId: artboard.id,
                  name: stringOrNull(artboard.name),
                  width: numberOrNull(artboard.width),
                  height: numberOrNull(artboard.height),
                } satisfies PaperFrame,
              ]
            : [],
        ),
      };
    }),
    { capacity: 64, timeToLive: keepSuccesses(Duration.seconds(30)) },
  );

  /** Asked fresh before a frame is drawn, so a deleted one is not drawn as an empty shell. */
  const frameDeleted = Effect.fn("PaperService.frameDeleted")(function* (
    fileId: string,
    nodeId: string,
  ) {
    return yield* payloadJson(yield* call("get_node_info", { fileId, nodeId })).pipe(
      Effect.map(isDeletedFrame),
      Effect.catchTags({
        PaperUnavailableError: (error) =>
          error.reason === "failed" && isDeletedFrame(error.detail)
            ? Effect.succeed(true)
            : Effect.fail(error),
      }),
    );
  });

  const frameImages = yield* Cache.makeWith(
    Effect.fn("PaperService.frameImage")(function* (cacheKey: string) {
      const [fileId, nodeId] = split(cacheKey);
      if (yield* frameDeleted(fileId, nodeId)) return { _tag: "frameDeleted" as const };
      const result = yield* call("get_screenshot", { fileId, nodeId, scale: 0.5 });
      const image = result.content.find(
        (block) => block.type === "image" && typeof block.data === "string",
      );
      if (result.isError || image?.data === undefined)
        return yield* failed("Paper returned no image.");
      const extension = image.mimeType === "image/png" ? "png" : "jpg";
      // No extension in the id, so the asset route serves it inline as an image.
      const attachmentId = createPendingAttachmentId();
      const filePath = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: `${attachmentId}.${extension}`,
      });
      if (filePath === null) return yield* failed("Invalid attachment path.");
      yield* fileSystem
        .writeFile(filePath, Buffer.from(image.data, "base64"))
        .pipe(Effect.mapError(() => failed("Could not store the image.")));
      return { _tag: "frameImage" as const, attachmentId };
    }),
    { capacity: 256, timeToLive: keepFrames(Duration.minutes(2)) },
  );

  // Frames reference the file's design tokens as CSS variables; without them colors fall back.
  const fileTokens = yield* Cache.makeWith(
    Effect.fn("PaperService.fileTokens")(function* (fileId: string) {
      return yield* payloadText(yield* call("get_tokens", { fileId, format: "css" }));
    }),
    { capacity: 64, timeToLive: keepSuccesses(Duration.minutes(5)) },
  );

  const liveFrames = yield* Cache.makeWith(
    Effect.fn("PaperService.liveFrame")(function* (cacheKey: string) {
      const [fileId, nodeId] = split(cacheKey);
      if (yield* frameDeleted(fileId, nodeId)) return { _tag: "frameDeleted" as const };
      const frame = yield* Cache.get(nodeInfo, key(fileId, nodeId));
      const jsx = yield* payloadText(
        yield* call("get_jsx", { fileId, nodeId, includeNodeIds: true }),
      );
      const size = yield* Effect.try({
        try: () => paperJsxRootSize(jsx),
        catch: (cause) => failed(`Could not convert this frame: ${String(cause)}`),
      });
      const tokens = yield* Cache.get(fileTokens, fileId).pipe(Effect.orElseSucceed(() => ""));
      const html = yield* Effect.try({
        try: () => paperJsxToHtml(jsx, frame.name ?? "Paper frame", tokens),
        catch: (cause) => failed(`Could not convert this frame: ${String(cause)}`),
      });
      // `pending-` attachments are swept after a day; the `-html` suffix serves them sandboxed.
      const attachmentId = createPendingAttachmentId("html");
      const filePath = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: `${attachmentId}.html`,
      });
      if (filePath === null) return yield* failed("Invalid attachment path.");
      yield* fileSystem
        .writeFileString(filePath, html)
        .pipe(Effect.mapError(() => failed("Could not store the frame.")));
      return {
        _tag: "liveFrame" as const,
        attachmentId,
        width: frame.width ?? size.width ?? 0,
        height: frame.height ?? size.height ?? 0,
      };
    }),
    { capacity: 128, timeToLive: keepFrames(Duration.minutes(30)) },
  );

  return PaperService.of({
    request: Effect.fn("PaperService.request")(function* (input: PaperRequest) {
      switch (input._tag) {
        case "connections":
          return { _tag: "connections" as const, connections: yield* connections };
        case "frameNames": {
          const frames = yield* Effect.forEach(
            input.frames,
            (frame) =>
              Cache.get(nodeInfo, key(frame.fileId, frame.nodeId)).pipe(
                Effect.catchTags({
                  PaperUnavailableError: (error) =>
                    error.reason === "failed"
                      ? Effect.succeed({
                          ...frame,
                          name: null,
                          width: null,
                          height: null,
                        } satisfies PaperFrame)
                      : Effect.fail(error),
                }),
              ),
            { concurrency: 4 },
          );
          return { _tag: "frameNames" as const, frames };
        }
        case "listFrames":
          return yield* Cache.get(fileFrames, input.fileId);
        case "artboardOf":
          return yield* Cache.get(artboards, key(input.fileId, input.nodeId));
        case "frameImage":
          return yield* Cache.get(
            frameImages,
            key(input.fileId, input.nodeId, input.revision ?? ""),
          );
        case "liveFrame":
          return yield* Cache.get(
            liveFrames,
            key(input.fileId, input.nodeId, input.revision ?? ""),
          );
      }
    }),
    account: Effect.fn("PaperService.account")(function* (input: PaperAccountRequest) {
      switch (input._tag) {
        case "signInStart":
          return { _tag: "signInStart" as const, ...(yield* account.start()) };
        case "signInWait": {
          const email = yield* account.wait;
          yield* hosted.close;
          yield* Ref.update(health, (current) => {
            const next = new Map(current);
            next.delete("account");
            return next;
          });
          return { _tag: "signInWait" as const, email };
        }
        case "signInCancel":
          yield* account.cancel;
          return { _tag: "signInCancel" as const };
        case "signOut":
          yield* account.signOut;
          yield* hosted.close;
          return { _tag: "signOut" as const };
      }
    }),
  });
});

export const layer = Layer.effect(PaperService, make());
