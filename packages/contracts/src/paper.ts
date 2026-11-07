// T3 Space fork: requests the clients make to Paper through the server.
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Posted by a live frame to its parent with its rendered `width` and `height`. */
export const PAPER_FRAME_SIZE_MESSAGE = "t3-paper-frame-size";

const PaperId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const PaperFrameRef = Schema.Struct({ fileId: PaperId, nodeId: PaperId });
export type PaperFrameRef = typeof PaperFrameRef.Type;

export const PaperFrame = Schema.Struct({
  fileId: PaperId,
  nodeId: PaperId,
  name: Schema.NullOr(Schema.String),
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
});
export type PaperFrame = typeof PaperFrame.Type;

export const PaperRequest = Schema.Union([
  Schema.TaggedStruct("frameNames", {
    frames: Schema.Array(PaperFrameRef).check(Schema.isMaxLength(64)),
  }),
  Schema.TaggedStruct("listFrames", { fileId: PaperId }),
  /** `revision` names the screenshot the frame came from, so a newer drawing is fetched again. */
  Schema.TaggedStruct("liveFrame", {
    fileId: PaperId,
    nodeId: PaperId,
    revision: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  }),
]);
export type PaperRequest = typeof PaperRequest.Type;

export const PaperResponse = Schema.Union([
  Schema.TaggedStruct("frameNames", { frames: Schema.Array(PaperFrame) }),
  Schema.TaggedStruct("listFrames", {
    fileName: Schema.NullOr(Schema.String),
    frames: Schema.Array(PaperFrame),
  }),
  Schema.TaggedStruct("liveFrame", {
    attachmentId: TrimmedNonEmptyString,
    width: Schema.Number,
    height: Schema.Number,
  }),
]);
export type PaperResponse = typeof PaperResponse.Type;

export class PaperUnavailableError extends Schema.TaggedError<PaperUnavailableError>()(
  "PaperUnavailableError",
  {
    reason: Schema.Literals(["disabled", "not-configured", "unreachable", "failed"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Paper is unavailable (${this.reason}): ${this.detail}`;
  }
}
