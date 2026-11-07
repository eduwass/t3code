// T3 Space fork: what clients ask Paper for. Frame names, a file's frames, and
// a frame converted to standalone HTML ("live frame"). Behind the Paper Labs
// switch; the command comes from T3_PAPER_MCP_COMMAND or a local Paper Desktop.
// @effect-diagnostics globalJsonInEffect:off
import {
  PaperUnavailableError,
  type PaperFrame,
  type PaperRequest,
  type PaperResponse,
} from "@t3tools/contracts";
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

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as PaperConnection from "./PaperConnection.ts";
import { paperJsxRootSize, paperJsxToHtml } from "./paperJsxToHtml.ts";

export class PaperService extends Context.Service<
  PaperService,
  {
    readonly request: (input: PaperRequest) => Effect.Effect<PaperResponse, PaperUnavailableError>;
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
const keepSuccesses = (ttl: Duration.Input) => (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? ttl : Duration.zero;

const make = Effect.fn("PaperService.make")(function* () {
  const connection = yield* PaperConnection.make();
  const settings = yield* ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configured = yield* Config.String("T3_PAPER_MCP_COMMAND").pipe(Config.option);
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));
  const localPaper = home === "" ? null : path.join(home, ".paper", "bin", "paper");

  const command = Effect.gen(function* () {
    const enabled = yield* settings.getSettings.pipe(
      Effect.map((current) => current.paperIntegrationEnabled),
      Effect.orElseSucceed(() => false),
    );
    if (!enabled) {
      yield* connection.close;
      return yield* new PaperUnavailableError({
        reason: "disabled",
        detail: "Paper integration is off in Labs.",
      });
    }
    if (Option.isSome(configured) && configured.value.trim() !== "") return configured.value;
    if (
      localPaper !== null &&
      (yield* fileSystem.exists(localPaper).pipe(Effect.orElseSucceed(() => false)))
    ) {
      return `"${localPaper}" mcp`;
    }
    return yield* new PaperUnavailableError({
      reason: "not-configured",
      detail: "Set T3_PAPER_MCP_COMMAND, or install Paper Desktop on this machine.",
    });
  });

  const call = (name: string, args: Record<string, unknown>) =>
    Effect.flatMap(command, (cmd) => connection.callTool(cmd, name, args));

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
    { capacity: 128, timeToLive: keepSuccesses(Duration.minutes(30)) },
  );

  return PaperService.of({
    request: Effect.fn("PaperService.request")(function* (input: PaperRequest) {
      switch (input._tag) {
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
        case "liveFrame":
          return yield* Cache.get(
            liveFrames,
            key(input.fileId, input.nodeId, input.revision ?? ""),
          );
      }
    }),
  });
});

export const layer = Layer.effect(PaperService, make());
