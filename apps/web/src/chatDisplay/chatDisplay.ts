// T3 Space fork: choose what the chat shows for tool calls, images, and Paper frames.
// Behind a per-device Labs switch; the settings themselves live in server settings,
// so they can differ per project and per environment.
import {
  toolGroupAction,
  workEntryDisplayIndicatesToolFailure,
  workEntryHiddenByToolCallVisibility,
  workEntryViewedImagePath,
} from "@t3tools/client-runtime/work-log/presentation";
import {
  paperShotsFromProjectedItems,
  paperToolName,
} from "@t3tools/client-runtime/work-log/paper-tools";
import type { EnvironmentId, ScopedThreadRef, ToolCallVisibility } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { createContext, use } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import type { WorkLogEntry } from "../session-logic";
import { useQuietThreadShell } from "../state/entities";
import {
  type ChatDisplayKind,
  type ChatDisplaySettings,
  resolveChatDisplay,
  useChatDisplayStore,
} from "./chatDisplayStore";

const ENABLED_KEY = "t3code:chat-display:v1";

/** The Labs switch. Per device, so turning it on here changes nothing elsewhere. */
export function useChatDisplayEnabled() {
  return useLocalStorage(ENABLED_KEY, false, Schema.Boolean);
}

/**
 * What the timeline filters with: upstream's choice, or the fork's settings while the
 * switch is on. Show all and Zen pass through as upstream's own values.
 */
export type TimelineToolCallVisibility = ToolCallVisibility | ChatDisplaySettings;

export function timelineToolCallVisibility(
  preferred: ToolCallVisibility,
  display: ChatDisplaySettings | null,
): TimelineToolCallVisibility {
  if (display === null) return preferred;
  return display.mode === "showAll" || display.mode === "zen" ? display.mode : display;
}

/** The thread's chat display settings, or null while the Labs switch is off. */
export function useChatDisplay(
  environmentId: EnvironmentId,
  threadRef: ScopedThreadRef | null,
): ChatDisplaySettings | null {
  const [enabled] = useChatDisplayEnabled();
  const projectId = useQuietThreadShell(threadRef)?.projectId ?? null;
  const [store] = useChatDisplayStore();
  const display = stableDisplay(resolveChatDisplay(store, environmentId, projectId));
  return enabled ? display : null;
}

// Storage decodes a new object each render; the timeline memoizes rows on this identity.
const stableDisplays = new Map<string, ChatDisplaySettings>();
function stableDisplay(display: ChatDisplaySettings): ChatDisplaySettings {
  const key = JSON.stringify(display);
  const known = stableDisplays.get(key);
  if (known) return known;
  if (stableDisplays.size > 32) stableDisplays.clear();
  stableDisplays.set(key, display);
  return display;
}

/** Rows read the thread's settings from here; null means upstream behaviour. */
export const ChatDisplayCtx = createContext<ChatDisplaySettings | null>(null);
export const useChatDisplayContext = () => use(ChatDisplayCtx);

// Commands that only look. Anything chained, redirected, or substituted stays a command.
const READ_ONLY_COMMAND =
  /^(?:ls|ll|cat|bat|head|tail|less|rg|grep|ag|fd|find|tree|pwd|wc|stat|file|which|du|sed -n|jq|git (?:status|diff|log|show|branch|blame|ls-files|rev-parse|remote -v))(?:\s|$)/;
const SHELL_WRAPPER = /^(?:\/bin\/|\/usr\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/;

export function isReadOnlyCommand(command: string | undefined): boolean {
  if (!command) return false;
  let text = command.trim();
  const wrapped = SHELL_WRAPPER.exec(text);
  if (wrapped) text = wrapped[2]!.trim();
  if (/[;&>`]|\$\(|\|\|/.test(text)) return false;
  return text.split("|").every((part) => READ_ONLY_COMMAND.test(part.trim()));
}

/** The grid row an entry belongs to; null for what always shows (approvals, questions, errors). */
export function chatDisplayKind(
  entry: WorkLogEntry,
  display: Pick<ChatDisplaySettings, "readOnlyCommandsAsReads">,
): ChatDisplayKind | null {
  switch (entry.itemType) {
    case "reasoning":
      return "thinking";
    case "todo_list":
      return "todo";
    case "subagent":
    case "thread_created":
      return "subagent";
    case "file_change":
      return "edit";
    case "file_search":
      return "read";
    case "command_execution":
      return display.readOnlyCommandsAsReads && isReadOnlyCommand(entry.command)
        ? "read"
        : "command";
    case "web_search":
      return toolGroupAction(entry) === "search" ? "web" : "read";
    case "dynamic_tool": {
      const payload = entry.structuredPayload;
      const toolName =
        payload?.type === "dynamic_tool"
          ? payload.toolName
          : (entry.toolData as { toolName?: string } | undefined)?.toolName;
      if (paperToolName(toolName)) return "paper";
      const action = toolGroupAction(entry);
      if (action === "read" || action === "code-search") return "read";
      if (action === "edit") return "edit";
      if (action === "command") return "command";
      if (action === "search") return "web";
      return "mcp";
    }
    default:
      return entry.viewedImagePath ? "read" : null;
  }
}

function entryFailed(entry: WorkLogEntry): boolean {
  return (
    entry.toolLifecycleStatus === "failed" ||
    entry.toolLifecycleStatus === "declined" ||
    workEntryDisplayIndicatesToolFailure(entry)
  );
}

/** Whether the settings hide this entry at all (folded or removed). */
function chatDisplayHidesEntry(
  entry: WorkLogEntry,
  visibility: TimelineToolCallVisibility,
): boolean {
  if (typeof visibility === "string") return workEntryHiddenByToolCallVisibility(entry, visibility);
  if (visibility.mode !== "custom") {
    return workEntryHiddenByToolCallVisibility(
      entry,
      visibility.mode === "hideSuccessful" ? "hideSuccessful" : "hideAll",
    );
  }
  const kind = chatDisplayKind(entry, visibility);
  if (kind === null) return false;
  const rule = visibility.rules[kind];
  if (rule === "show") return false;
  if (rule === "hide") return true;
  // Like Hide successful: a running call stays visible until it settles.
  return entry.toolLifecycleStatus === "completed" && !entryFailed(entry);
}

/** Images and Paper frames this entry puts on screen even when its row is hidden. */
function chatDisplayEntryMedia(entry: WorkLogEntry, display: ChatDisplaySettings) {
  const image = display.images !== "click" && workEntryViewedImagePath(entry) !== null;
  const paper =
    paperFramesShown(display) && paperShotsFromProjectedItems([entry.projectedItem]).length > 0;
  return { image, paper };
}

/** Paper frames follow the chat display's choice; with the switch off they always show. */
export function paperFramesShown(display: ChatDisplaySettings | null): boolean {
  if (display === null || display.paperFrames === "always") return true;
  return display.paperFrames === "like-images" && display.images !== "click";
}

/** Hidden and dropped from the timeline: upstream's behaviour, or the Remove choice. */
export function chatDisplayRemovesEntry(
  entry: WorkLogEntry,
  visibility: TimelineToolCallVisibility,
): boolean {
  if (!chatDisplayHidesEntry(entry, visibility)) return false;
  if (typeof visibility === "string") return true;
  // Thinking and todo rows are not tool calls; folding them adds noise.
  const kind = chatDisplayKind(entry, visibility);
  if (kind === "thinking" || kind === "todo") return true;
  if (visibility.hidden === "fold") return false;
  const media = chatDisplayEntryMedia(entry, visibility);
  return !media.image && !media.paper;
}

/** Hidden but kept, so it folds into a "N hidden" row with others like it. */
export function chatDisplayFoldsEntry(
  entry: WorkLogEntry,
  visibility: TimelineToolCallVisibility | undefined,
): boolean {
  return (
    visibility !== undefined &&
    typeof visibility !== "string" &&
    chatDisplayHidesEntry(entry, visibility) &&
    !chatDisplayRemovesEntry(entry, visibility)
  );
}

const KIND_NOUN: Record<ChatDisplayKind, [string, string]> = {
  command: ["command", "commands"],
  edit: ["edit", "edits"],
  read: ["read", "reads"],
  web: ["web search", "web searches"],
  paper: ["Paper call", "Paper calls"],
  mcp: ["tool call", "tool calls"],
  subagent: ["subagent", "subagents"],
  thinking: ["thought", "thoughts"],
  todo: ["todo update", "todo updates"],
};

export function chatDisplayHiddenSummary(
  entries: ReadonlyArray<WorkLogEntry>,
  display: Pick<ChatDisplaySettings, "readOnlyCommandsAsReads">,
): string {
  const counts = new Map<ChatDisplayKind, number>();
  for (const entry of entries) {
    const kind = chatDisplayKind(entry, display) ?? "mcp";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts].map(
    ([kind, count]) => `${count} ${KIND_NOUN[kind][count > 1 ? 1 : 0]}`,
  );
  return `${entries.length} hidden · ${parts.join(", ")}`;
}

/** Entries whose images a collapsed row keeps on show. */
export function chatDisplayImageEntries(
  entries: ReadonlyArray<WorkLogEntry | undefined>,
): ReadonlyArray<WorkLogEntry> {
  return entries.filter(
    (entry): entry is WorkLogEntry =>
      entry !== undefined && workEntryViewedImagePath(entry) !== null,
  );
}

export const chatDisplayImagesKey = (entries: ReadonlyArray<WorkLogEntry> | undefined) =>
  entries?.map((entry) => entry.id).join("|") ?? "";
