// T3 Space fork: the Labs switch and the Chat page section for the chat display.

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { useOptionalSettingsScope } from "../components/settings/SettingsScopeContext";
import type { ResolvedSettingsScope } from "../components/settings/settingsScope";
import { searchableSetting } from "../components/settings/settingsSearch";
import { useScopedSettings } from "../components/settings/useScopedSettings";
import { useChatDisplayEnabled } from "./chatDisplay";
import {
  CHAT_DISPLAY_KINDS,
  type ChatDisplayKind,
  type ChatDisplayRule,
  type ChatDisplaySettings as ChatDisplaySettingsValue,
  type ChatDisplayStore,
  chatDisplayProjectKey,
  DEFAULT_CHAT_DISPLAY_SETTINGS,
  resolveChatDisplay,
  useChatDisplayStore,
} from "./chatDisplayStore";
import { ChatDisplayPreview } from "./ChatDisplayPreview";

export function ChatDisplayLabsRow() {
  const [enabled, setEnabled] = useChatDisplayEnabled();
  return (
    <SettingsRow
      {...searchableSetting("chat-display")}
      description="Choose what the chat shows per kind of tool call, and show the images and Paper frames agents look at. Replaces Tool calls in chat. Set it up in Chat, per project if you like."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          aria-label="Chat display"
        />
      }
    />
  );
}

const MODE_LABELS = {
  showAll: "Show all",
  hideSuccessful: "Hide successful",
  hideAll: "Hide all",
  zen: "Zen",
  custom: "Custom",
} as const;
const KIND_LABELS: Record<ChatDisplayKind, string> = {
  command: "Commands",
  edit: "File edits",
  read: "Reads & searches",
  web: "Web search & fetch",
  paper: "Paper",
  mcp: "MCP & other tools",
  subagent: "Subagents",
  thinking: "Thinking",
  todo: "Todo lists & plans",
};
const RULE_LABELS: Record<ChatDisplayRule, string> = {
  show: "Show",
  failures: "Failures only",
  hide: "Hide",
};
const HIDDEN_LABELS = { fold: "Fold into a row", remove: "Remove" } as const;
const IMAGE_LABELS = { click: "Hidden until clicked", thumbnails: "Thumbnails", full: "Full" };
const PAPER_LABELS = { "like-images": "Like other images", always: "Always show", hide: "Hide" };

function Choice<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly labels: Readonly<Record<T, string>>;
  readonly options?: ReadonlyArray<T> | undefined;
  readonly small?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const options = props.options ?? (Object.keys(props.labels) as T[]);
  return (
    <Select
      value={props.value}
      onValueChange={(raw) => {
        const next = options.find((option) => option === raw);
        if (next !== undefined) props.onChange(next);
      }}
    >
      <SelectTrigger
        size={props.small ? "xs" : "sm"}
        className={props.small ? "w-36" : "w-full min-w-0 sm:w-48"}
        aria-label={props.label}
      >
        <SelectValue>{props.labels[props.value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem hideIndicator key={option} value={option}>
            {props.labels[option]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Where the settings page's scope picker writes: everything, or these overrides. */
type ScopeTargets =
  | { readonly kind: "all" }
  | {
      readonly kind: "overrides";
      readonly environments: ReadonlyArray<string>;
      readonly projects: ReadonlyArray<{ readonly environmentId: string; readonly id: string }>;
    }
  | { readonly kind: "unavailable" };

function scopeTargets(scope: ResolvedSettingsScope | undefined): ScopeTargets {
  switch (scope?.kind) {
    case undefined:
    case "all":
      return { kind: "all" };
    case "environment":
      return { kind: "overrides", environments: [scope.environmentId], projects: [] };
    case "project":
      return {
        kind: "overrides",
        environments: [],
        projects: scope.members.filter(
          (member) => scope.environmentId === null || member.environmentId === scope.environmentId,
        ),
      };
    case "checkout":
      return { kind: "overrides", environments: [], projects: [scope.checkout] };
    case "unavailable":
      return { kind: "unavailable" };
  }
}

function scopedDisplay(store: ChatDisplayStore, targets: ScopeTargets): ChatDisplaySettingsValue {
  if (targets.kind !== "overrides") return store.all ?? DEFAULT_CHAT_DISPLAY_SETTINGS;
  const project = targets.projects[0];
  if (project) return resolveChatDisplay(store, project.environmentId, project.id);
  const environmentId = targets.environments[0];
  return environmentId
    ? resolveChatDisplay(store, environmentId, null)
    : (store.all ?? DEFAULT_CHAT_DISPLAY_SETTINGS);
}

function writeScope(
  store: ChatDisplayStore,
  targets: ScopeTargets,
  next: ChatDisplaySettingsValue | null,
): ChatDisplayStore {
  if (targets.kind === "unavailable") return store;
  if (targets.kind === "all") {
    const { all: _all, ...rest } = store;
    return next === null ? rest : { ...rest, all: next };
  }
  const environments = { ...store.environments };
  const projects = { ...store.projects };
  for (const id of targets.environments) {
    if (next === null) delete environments[id];
    else environments[id] = next;
  }
  for (const project of targets.projects) {
    const key = chatDisplayProjectKey(project.environmentId, project.id);
    if (next === null) delete projects[key];
    else projects[key] = next;
  }
  return { ...store, environments, projects };
}

function scopeOverridden(store: ChatDisplayStore, targets: ScopeTargets): boolean {
  if (targets.kind !== "overrides") return false;
  return (
    targets.environments.some((id) => id in store.environments) ||
    targets.projects.some(
      (project) => chatDisplayProjectKey(project.environmentId, project.id) in store.projects,
    )
  );
}

export function ChatDisplaySection() {
  const [enabled] = useChatDisplayEnabled();
  const [store, setStore] = useChatDisplayStore();
  const targets = scopeTargets(useOptionalSettingsScope()?.scope);
  const paperEnabled = useScopedSettings((settings) => settings.paperIntegrationEnabled);
  if (!enabled) return null;
  const display = scopedDisplay(store, targets);
  const set = (patch: Partial<ChatDisplaySettingsValue>) =>
    setStore((current) => writeScope(current, targets, { ...display, ...patch }));
  const overridden = scopeOverridden(store, targets);
  return (
    <SettingsSection
      id="chat-display"
      title="Tool calls & images (T3 Space)"
      headerAction={
        overridden ? (
          <SettingResetButton
            label="chat display"
            tooltip="Reset to the inherited settings"
            onClick={() => setStore((current) => writeScope(current, targets, null))}
          />
        ) : null
      }
    >
      <SettingsRow
        {...searchableSetting("chat-display-tool-calls")}
        title="Tool calls"
        description="Show all, Hide successful, Hide all, and Zen work as they do in Labs. Custom sets each kind on its own. Approvals, questions, and errors always show."
        control={
          <Choice
            label="Tool calls"
            value={display.mode}
            labels={MODE_LABELS}
            onChange={(mode) => set({ mode })}
          />
        }
      >
        {display.mode === "custom" ? (
          <div className="mb-2 divide-y divide-border/50 rounded-lg border border-border/60">
            {CHAT_DISPLAY_KINDS.filter((kind) => kind !== "paper" || paperEnabled).map((kind) => (
              <div key={kind} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="text-sm">{KIND_LABELS[kind]}</span>
                <Choice
                  small
                  label={KIND_LABELS[kind]}
                  value={display.rules[kind]}
                  labels={RULE_LABELS}
                  options={kind === "thinking" || kind === "todo" ? ["show", "hide"] : undefined}
                  onChange={(rule) => set({ rules: { ...display.rules, [kind]: rule } })}
                />
              </div>
            ))}
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="Hidden tool calls"
        description="Fold them into one row you can open, or leave no trace. Images and Paper frames that would show keep their row either way."
        control={
          <Choice
            label="Hidden tool calls"
            value={display.hidden}
            labels={HIDDEN_LABELS}
            onChange={(hidden) => set({ hidden })}
          />
        }
      />
      <SettingsRow
        title="Images agents look at"
        description="Screenshots and images an agent reads. Thumbnails and Full stay visible even when reads are hidden. Click one to open it."
        control={
          <Choice
            label="Images agents look at"
            value={display.images}
            labels={IMAGE_LABELS}
            onChange={(images) => set({ images })}
          />
        }
      />
      <SettingsRow
        title="Count read-only commands as reads"
        description="ls, cat, rg, git status, git diff, and other commands that only look follow the Reads rule instead of Commands."
        control={
          <Switch
            checked={display.readOnlyCommandsAsReads}
            onCheckedChange={(checked) => set({ readOnlyCommandsAsReads: Boolean(checked) })}
            aria-label="Count read-only commands as reads"
          />
        }
      />
      {paperEnabled ? (
        <>
          <SettingsRow
            title="Paper frames"
            description="The frames an agent drew in Paper. Like other images follows the setting above. Always show keeps them even when other images wait for a click."
            control={
              <Choice
                label="Paper frames"
                value={display.paperFrames}
                labels={PAPER_LABELS}
                onChange={(paperFrames) => set({ paperFrames })}
              />
            }
          />
          <SettingsRow
            title="Live drawing line"
            description="While an agent draws, a line under its tool row names the frame it is working on."
            control={
              <Switch
                checked={display.paperLiveLine}
                onCheckedChange={(checked) => set({ paperLiveLine: Boolean(checked) })}
                aria-label="Live drawing line"
              />
            }
          />
        </>
      ) : null}
      <SettingsRow
        title="Preview"
        description="Sample turns, drawn with the settings above. Folded rows open on click."
      >
        <ChatDisplayPreview display={display} paperEnabled={paperEnabled} />
      </SettingsRow>
    </SettingsSection>
  );
}
