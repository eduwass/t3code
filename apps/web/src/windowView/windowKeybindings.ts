import {
  matchesKeybindingShortcut,
  parseKeybindingShortcut,
  type ShortcutEventLike,
} from "@t3tools/shared/keybindings";
import { create } from "zustand";

import type { SavedWindowView } from "./windowView.logic";

// Window shortcuts are kept by T3 Space on this machine: keybindings normally live
// on the server, and the server (upstream T3 Code) has no window commands.
const STORAGE_KEY = "t3space:window-keybindings:v1";

export type WindowKeybindingId = "new-window" | "view-menu" | `view:${string}`;

export interface WindowKeybindingRow {
  readonly id: WindowKeybindingId;
  readonly label: string;
  readonly description: string;
  /** A shortcut such as `mod+ctrl+n`; empty when unassigned. */
  readonly key: string;
}

type Overrides = Readonly<Record<string, string>>;

const defaultKey = (id: WindowKeybindingId, savedViews: readonly SavedWindowView[]): string => {
  if (id === "new-window") return "mod+ctrl+n";
  if (id === "view-menu") return "";
  const index = savedViews.findIndex((saved) => `view:${saved.name}` === id);
  return index >= 0 && index < 9 ? `mod+ctrl+${index + 1}` : "";
};

const describe = (saved: SavedWindowView) =>
  `${saved.mode === "only" ? "" : "All except "}${saved.projects.join(", ")}`;

export function windowKeybindingRows(
  savedViews: readonly SavedWindowView[],
  overrides: Overrides,
): WindowKeybindingRow[] {
  const row = (id: WindowKeybindingId, label: string, description: string) => ({
    id,
    label,
    description,
    key: overrides[id] ?? defaultKey(id, savedViews),
  });
  return [
    row("new-window", "New window", "Same view as the focused one"),
    ...savedViews.map((saved) =>
      row(`view:${saved.name}`, `Open view: ${saved.name}`, describe(saved)),
    ),
    row("view-menu", "Move window to view…", "Re-scope the focused window"),
  ];
}

/** The window shortcut a keydown triggers, if any. */
export function resolveWindowKeybinding(
  event: ShortcutEventLike,
  rows: readonly WindowKeybindingRow[],
  platform: string,
): WindowKeybindingId | null {
  for (const row of rows) {
    const shortcut = row.key === "" ? null : parseKeybindingShortcut(row.key);
    if (shortcut !== null && matchesKeybindingShortcut(event, shortcut, platform)) return row.id;
  }
  return null;
}

const readOverrides = (): Overrides => {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}");
    if (typeof raw !== "object" || raw === null) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
};

export const useWindowKeybindingsStore = create<{ readonly overrides: Overrides }>(() => ({
  overrides: readOverrides(),
}));

/** Sets a shortcut; an empty key unassigns it, null goes back to the default. */
export function setWindowKeybinding(id: WindowKeybindingId, key: string | null): void {
  const { [id]: _previous, ...rest } = useWindowKeybindingsStore.getState().overrides;
  const overrides = key === null ? rest : { ...rest, [id]: key };
  useWindowKeybindingsStore.setState({ overrides });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // The shortcut still applies in this window until it closes.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY)
      useWindowKeybindingsStore.setState({ overrides: readOverrides() });
  });
}
