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

/** The two ways T3 reaches Paper: the Desktop app's MCP, or Paper's hosted MCP with an account. */
export const PaperConnectionKind = Schema.Literals(["desktop", "account"]);
export type PaperConnectionKind = typeof PaperConnectionKind.Type;

/** One entry in the user's ordered list; T3 tries enabled entries top to bottom. */
export const PaperConnectionSetting = Schema.Struct({
  kind: PaperConnectionKind,
  enabled: Schema.Boolean,
});
export type PaperConnectionSetting = typeof PaperConnectionSetting.Type;

export const DEFAULT_PAPER_CONNECTIONS: ReadonlyArray<PaperConnectionSetting> = [
  { kind: "desktop", enabled: true },
  { kind: "account", enabled: true },
];

/** The saved order with each kind once; kinds missing from it are appended, switched on. */
export function paperConnectionOrder(
  saved: ReadonlyArray<PaperConnectionSetting>,
): ReadonlyArray<PaperConnectionSetting> {
  const seen = new Set<PaperConnectionKind>();
  const order = [...saved, ...DEFAULT_PAPER_CONNECTIONS].filter((entry) => {
    if (seen.has(entry.kind)) return false;
    seen.add(entry.kind);
    return true;
  });
  return order;
}

export const PaperConnectionStatus = Schema.Struct({
  kind: PaperConnectionKind,
  enabled: Schema.Boolean,
  /** `missing`: no Desktop found, or no account signed in. `down`: the last call failed. */
  state: Schema.Literals(["in-use", "ready", "down", "missing", "off"]),
  /** The Desktop's machine, or the account's email. */
  label: Schema.NullOr(Schema.String),
  latencyMs: Schema.NullOr(Schema.Number),
});
export type PaperConnectionStatus = typeof PaperConnectionStatus.Type;

export const PaperRequest = Schema.Union([
  Schema.TaggedStruct("connections", {}),
  Schema.TaggedStruct("frameNames", {
    frames: Schema.Array(PaperFrameRef).check(Schema.isMaxLength(64)),
  }),
  Schema.TaggedStruct("listFrames", { fileId: PaperId }),
  /** A small screenshot, for frames the thread has none of, or a newer one after later writes. */
  Schema.TaggedStruct("frameImage", {
    fileId: PaperId,
    nodeId: PaperId,
    revision: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  }),
  /** `revision` names the screenshot the frame came from, so a newer drawing is fetched again. */
  Schema.TaggedStruct("liveFrame", {
    fileId: PaperId,
    nodeId: PaperId,
    revision: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  }),
]);
export type PaperRequest = typeof PaperRequest.Type;

export const PaperResponse = Schema.Union([
  Schema.TaggedStruct("connections", { connections: Schema.Array(PaperConnectionStatus) }),
  Schema.TaggedStruct("frameNames", { frames: Schema.Array(PaperFrame) }),
  Schema.TaggedStruct("listFrames", {
    fileName: Schema.NullOr(Schema.String),
    frames: Schema.Array(PaperFrame),
  }),
  Schema.TaggedStruct("frameImage", { attachmentId: TrimmedNonEmptyString }),
  Schema.TaggedStruct("liveFrame", {
    attachmentId: TrimmedNonEmptyString,
    width: Schema.Number,
    height: Schema.Number,
  }),
  /** Answers `frameImage` and `liveFrame` when the frame is no longer in the file. */
  Schema.TaggedStruct("frameDeleted", {}),
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

/** Signs this server in to a Paper account with a device code, or out of it. */
export const PaperAccountRequest = Schema.Union([
  Schema.TaggedStruct("signInStart", {}),
  /** Resolves when the sign-in `signInStart` began ends, however long the user takes. */
  Schema.TaggedStruct("signInWait", {}),
  Schema.TaggedStruct("signInCancel", {}),
  Schema.TaggedStruct("signOut", {}),
]);
export type PaperAccountRequest = typeof PaperAccountRequest.Type;

export const PaperAccountResponse = Schema.Union([
  /** The user approves `userCode` at `verificationUri`; `verificationUriComplete` carries it. */
  Schema.TaggedStruct("signInStart", {
    userCode: TrimmedNonEmptyString,
    verificationUri: TrimmedNonEmptyString,
    verificationUriComplete: Schema.NullOr(TrimmedNonEmptyString),
    expiresAt: Schema.Number,
  }),
  Schema.TaggedStruct("signInWait", { email: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("signInCancel", {}),
  Schema.TaggedStruct("signOut", {}),
]);
export type PaperAccountResponse = typeof PaperAccountResponse.Type;

export class PaperSignInError extends Schema.TaggedError<PaperSignInError>()("PaperSignInError", {
  reason: Schema.Literals(["not-started", "cancelled", "denied", "expired", "failed"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Paper sign-in ${this.reason}: ${this.detail}`;
  }
}
