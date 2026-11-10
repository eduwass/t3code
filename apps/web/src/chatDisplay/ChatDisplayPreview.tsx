// T3 Space fork: sample turns drawn with the chat display rules the timeline uses.
import type { ChatDisplaySettings } from "./chatDisplayStore";
import {
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  LayersIcon,
  ListChecksIcon,
  PaletteIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../lib/utils";
import type { WorkLogEntry } from "../session-logic";
import {
  chatDisplayFoldsEntry,
  chatDisplayHiddenSummary,
  chatDisplayKind,
  chatDisplayRemovesEntry,
  paperFramesShown,
  timelineToolCallVisibility,
} from "./chatDisplay";

interface SampleEntry extends WorkLogEntry {
  readonly icon: LucideIcon;
  /** A placeholder for an image the agent looked at. */
  readonly image?: true;
  /** A placeholder for a Paper frame the agent screenshotted. */
  readonly frame?: string;
}
interface SampleTurn {
  readonly user: string;
  readonly answer?: string;
  readonly drawing?: string;
  readonly work: ReadonlyArray<SampleEntry>;
}

let sampleId = 0;
function sample(
  label: string,
  icon: LucideIcon,
  fields: Partial<Omit<SampleEntry, "id" | "label" | "icon">>,
): SampleEntry {
  sampleId += 1;
  return {
    id: `sample-${sampleId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    tone: "tool",
    toolLifecycleStatus: "completed",
    label,
    icon,
    ...fields,
  };
}
const read = (label: string, extra: Partial<SampleEntry> = {}) =>
  sample(label, extra.image ? ImageIcon : FileTextIcon, {
    itemType: "dynamic_tool",
    requestKind: "file-read",
    ...extra,
  });
const command = (label: string, cmd: string, extra: Partial<SampleEntry> = {}) =>
  sample(label, TerminalIcon, { itemType: "command_execution", command: cmd, ...extra });
const paper = (label: string, extra: Partial<SampleEntry> = {}) =>
  sample(label, PaletteIcon, {
    itemType: "dynamic_tool",
    toolData: { toolName: "mcp__paper__write_html" },
    ...extra,
  });

const TURNS: ReadonlyArray<SampleTurn> = [
  {
    user: "does the settings page look right on mobile?",
    answer: "The rows wrapped on mobile, so I stacked the controls under their labels.",
    work: [
      sample("Thought for 4s", BrainIcon, { itemType: "reasoning", tone: "thinking" }),
      read("Read SettingsRow.tsx"),
      sample("Searched settings-row", SearchIcon, { itemType: "file_search" }),
      command("Ran ls apps/web/src", "ls apps/web/src"),
      sample("Used browser · screenshot", WrenchIcon, {
        itemType: "dynamic_tool",
        toolData: { toolName: "mcp__browser__screenshot" },
      }),
      read("Read settings-mobile.png", { image: true, viewedImagePath: "settings-mobile.png" }),
      sample("Edited SettingsRow.tsx", PencilIcon, { itemType: "file_change" }),
      command("Ran vp run typecheck", "vp run typecheck", { toolLifecycleStatus: "failed" }),
      sample("Edited SettingsRow.tsx", PencilIcon, { itemType: "file_change" }),
      command("Ran vp run typecheck", "vp run typecheck"),
      command("Ran git diff --stat", "git diff --stat"),
      read("Read settings-after.png", { image: true, viewedImagePath: "settings-after.png" }),
    ],
  },
  {
    user: "mock up the new section in Paper and check the docs",
    answer: "Two frames are in Paper: the settings page and the chat preview.",
    work: [
      sample("Searched base-ui select size", GlobeIcon, { itemType: "web_search" }),
      sample("Explore · find every Select", BotIcon, { itemType: "subagent" }),
      paper("Used Paper · write_html ×9"),
      paper("Used Paper · get_screenshot", { frame: "Settings → Chat" }),
      paper("Used Paper · get_screenshot", { frame: "Chat preview" }),
      sample("Updated todos · 3 of 3 done", ListChecksIcon, { itemType: "todo_list" }),
    ],
  },
  {
    user: "now add a dark version",
    drawing: "Settings → Chat (dark)",
    work: [paper("Used Paper · update_styles ×4", { toolLifecycleStatus: "inProgress" })],
  },
];

export function ChatDisplayPreview(props: {
  readonly display: ChatDisplaySettings;
  readonly paperEnabled: boolean;
}) {
  const { display, paperEnabled } = props;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const visibility = timelineToolCallVisibility("showAll", display);
  const imageClass = display.images === "full" ? "h-36 w-56" : "h-14 w-22";
  const showImage = display.images !== "click";
  const showFrame = paperEnabled && paperFramesShown(display);

  const media = (entries: ReadonlyArray<SampleEntry>) => {
    const items = entries.filter(
      (entry) => (entry.image && showImage) || (entry.frame && showFrame),
    );
    if (items.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-2 pb-1 pl-7">
        {items.map((entry) =>
          entry.frame ? (
            <figure key={entry.id} className="flex flex-col gap-1">
              <div className={cn("rounded-md border border-border bg-white", imageClass)} />
              <figcaption className="text-2xs text-muted-foreground">{entry.frame}</figcaption>
            </figure>
          ) : (
            <div
              key={entry.id}
              className={cn("rounded-md border border-border bg-muted", imageClass)}
            />
          ),
        )}
      </div>
    );
  };
  const row = (entry: SampleEntry) => {
    const failed = entry.toolLifecycleStatus === "failed";
    const Icon = entry.icon;
    return (
      <div key={entry.id}>
        <div
          className={cn(
            "flex min-h-7 items-center gap-2.5 text-sm",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {entry.label}
            {failed ? " · failed" : ""}
          </span>
          <ChevronRightIcon className="size-3.5 shrink-0 opacity-50" />
        </div>
        {media([entry])}
      </div>
    );
  };

  return (
    <div className="mb-2 flex flex-col gap-0.5 rounded-lg border border-border/60 bg-background px-4 py-3">
      {TURNS.map((turn, turnIndex) => {
        const nodes: ReactNode[] = [];
        let folded: SampleEntry[] = [];
        const flush = (at: number) => {
          if (folded.length === 0) return;
          const id = `${turnIndex}:${at}`;
          const entries = folded;
          const isOpen = open.has(id);
          nodes.push(
            <div key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="flex min-h-7 w-full items-center gap-2.5 text-left text-sm text-muted-foreground hover:text-foreground"
              >
                <LayersIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {chatDisplayHiddenSummary(entries, display)}
                </span>
                {isOpen ? (
                  <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
                ) : (
                  <ChevronRightIcon className="size-3.5 shrink-0 opacity-50" />
                )}
              </button>
              {isOpen ? (
                <div className="ml-2 border-l border-border/70 pl-3">{entries.map(row)}</div>
              ) : (
                media(entries)
              )}
            </div>,
          );
          folded = [];
        };
        if (display.mode !== "zen") {
          turn.work.forEach((entry, index) => {
            const kind = chatDisplayKind(entry, display);
            if (kind === "paper" && !paperEnabled) return;
            if (chatDisplayRemovesEntry(entry, visibility)) return;
            if (chatDisplayFoldsEntry(entry, visibility)) {
              folded.push(entry);
              return;
            }
            flush(index);
            nodes.push(row(entry));
          });
          flush(turn.work.length);
        }
        return (
          <div key={turn.user} className="flex flex-col gap-0.5">
            <div className="my-2 max-w-5/6 self-end rounded-xl bg-secondary px-3 py-1.5 text-sm">
              {turn.user}
            </div>
            {nodes}
            {turn.drawing && paperEnabled && display.paperLiveLine ? (
              <div className="flex min-h-7 items-center gap-2.5 text-xs text-muted-foreground">
                <span className="size-2 shrink-0 rounded-full bg-primary" />
                Drawing in Paper · {turn.drawing}
              </div>
            ) : null}
            {turn.answer ? (
              <p className="py-1 text-sm leading-relaxed">{turn.answer}</p>
            ) : (
              <p className="py-1 text-xs text-muted-foreground">Working…</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
