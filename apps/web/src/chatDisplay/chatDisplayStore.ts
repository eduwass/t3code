// T3 Space fork: what the chat shows for tool calls, images, and Paper frames.
// Stored on this device, for all projects or per environment and project.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../hooks/useLocalStorage";

export const CHAT_DISPLAY_KINDS = [
  "command",
  "edit",
  "read",
  "web",
  "paper",
  "mcp",
  "subagent",
  "thinking",
  "todo",
] as const;
export type ChatDisplayKind = (typeof CHAT_DISPLAY_KINDS)[number];

export const ChatDisplayRule = Schema.Literals(["show", "failures", "hide"]);
export type ChatDisplayRule = typeof ChatDisplayRule.Type;

const rule = (value: ChatDisplayRule) =>
  ChatDisplayRule.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const ChatDisplayRules = Schema.Struct({
  command: rule("failures"),
  edit: rule("show"),
  read: rule("hide"),
  web: rule("show"),
  paper: rule("hide"),
  mcp: rule("failures"),
  subagent: rule("show"),
  thinking: rule("hide"),
  todo: rule("show"),
});
export type ChatDisplayRules = typeof ChatDisplayRules.Type;

export const ChatDisplayMode = Schema.Literals([
  "showAll",
  "hideSuccessful",
  "hideAll",
  "zen",
  "custom",
]);
export type ChatDisplayMode = typeof ChatDisplayMode.Type;

export const ChatDisplaySettings = Schema.Struct({
  mode: ChatDisplayMode.pipe(Schema.withDecodingDefault(Effect.succeed("showAll" as const))),
  rules: ChatDisplayRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  hidden: Schema.Literals(["fold", "remove"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("fold" as const)),
  ),
  images: Schema.Literals(["click", "thumbnails", "full"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("thumbnails" as const)),
  ),
  readOnlyCommandsAsReads: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  paperFrames: Schema.Literals(["like-images", "always", "hide"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("like-images" as const)),
  ),
  paperLiveLine: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type ChatDisplaySettings = typeof ChatDisplaySettings.Type;

export const DEFAULT_CHAT_DISPLAY_SETTINGS: ChatDisplaySettings = Schema.decodeSync(
  ChatDisplaySettings,
)({});

// Device-local: an environment running stock T3 Code drops settings keys it does not know.
const STORE_KEY = "t3code:chat-display-settings:v1";
const ChatDisplayStore = Schema.Struct({
  all: Schema.optionalKey(ChatDisplaySettings),
  environments: Schema.Record(Schema.String, ChatDisplaySettings).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  projects: Schema.Record(Schema.String, ChatDisplaySettings).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type ChatDisplayStore = typeof ChatDisplayStore.Type;
const EMPTY_STORE: ChatDisplayStore = { environments: {}, projects: {} };

export function useChatDisplayStore() {
  return useLocalStorage(STORE_KEY, EMPTY_STORE, ChatDisplayStore);
}

export const chatDisplayProjectKey = (environmentId: string, projectId: string) =>
  `${environmentId}:${projectId}`;

/** A thread's settings: its project's, else its environment's, else the default for all. */
export function resolveChatDisplay(
  store: ChatDisplayStore,
  environmentId: string,
  projectId: string | null,
): ChatDisplaySettings {
  return (
    (projectId === null
      ? undefined
      : store.projects[chatDisplayProjectKey(environmentId, projectId)]) ??
    store.environments[environmentId] ??
    store.all ??
    DEFAULT_CHAT_DISPLAY_SETTINGS
  );
}
