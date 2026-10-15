import { create } from "zustand";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { useUiStateStore } from "../uiStateStore";
import {
  isWindowViewColor,
  normalizeWindowView,
  parseWindowViewSpec,
  sameWindowView,
  windowViewSpec,
  type SavedWindowView,
  type WindowView,
  type WindowViewColor,
} from "./windowView.logic";
import {
  resolveWindowKeybinding,
  useWindowKeybindingsStore,
  windowKeybindingRows,
} from "./windowKeybindings";

// This window's view lives in sessionStorage (per window, survives a reload);
// saved views live in localStorage, shared by every window.
const CURRENT_KEY = "t3space:window-view:v1";
const SAVED_KEY = "t3space:saved-window-views:v1";

interface WindowViewState {
  readonly view: WindowView | null;
  /** The saved view this window shows, while its projects still match it. */
  readonly savedName: string | null;
  readonly savedViews: readonly SavedWindowView[];
  /** The sidebar's project groups, published by the sidebar for the view menu. */
  readonly groups: readonly SidebarProjectSnapshot[];
  /** Threads per project group key, for the view menu. */
  readonly threadCounts: ReadonlyMap<string, number>;
  /** A new object asks the sidebar's project filter menu to open or close. */
  readonly menuRequest: { readonly count: number; readonly open: boolean };
  readonly saveDialogOpen: boolean;
  /** The mode new picks use while the window shows every project. */
  readonly pendingMode: "only" | "except";
}

const readJson = (storage: Storage | undefined, key: string): unknown => {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};

const toView = (value: unknown): WindowView | null => {
  if (typeof value !== "object" || value === null) return null;
  const { mode, projects } = value as { mode?: unknown; projects?: unknown };
  if ((mode !== "only" && mode !== "except") || !Array.isArray(projects)) return null;
  return normalizeWindowView({
    mode,
    projects: projects.filter((name): name is string => typeof name === "string"),
  });
};

const readSavedViews = (): SavedWindowView[] => {
  const raw = readJson(globalThis.localStorage, SAVED_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: { name?: unknown; color?: unknown }) => {
    const view = toView(entry);
    return view !== null && typeof entry.name === "string" && isWindowViewColor(entry.color)
      ? [{ ...view, name: entry.name, color: entry.color }]
      : [];
  });
};

const readCurrent = (): Pick<WindowViewState, "view" | "savedName"> => {
  const raw = readJson(globalThis.sessionStorage, CURRENT_KEY) as { savedName?: unknown } | null;
  return {
    view: toView(raw),
    savedName: typeof raw?.savedName === "string" ? raw.savedName : null,
  };
};

export const useWindowViewStore = create<WindowViewState>(() => ({
  ...readCurrent(),
  savedViews: readSavedViews(),
  groups: [],
  threadCounts: new Map(),
  menuRequest: { count: 0, open: false },
  saveDialogOpen: false,
  pendingMode: "only",
}));

const moveWindowViewMenu = (open: boolean) =>
  useWindowViewStore.setState((state) => ({
    menuRequest: { count: state.menuRequest.count + 1, open },
  }));

/** Opens the sidebar's project filter menu, where views are picked. */
export const requestWindowViewMenu = () => moveWindowViewMenu(true);
export const closeWindowViewMenu = () => moveWindowViewMenu(false);

/** Shows a view in this window. The sidebar's single-project filter steps aside. */
export function setWindowView(view: WindowView | null, savedName: string | null = null): void {
  const ui = useUiStateStore.getState();
  if (view !== null && ui.sidebarProjectScopeKey !== null) ui.setSidebarProjectScopeKey(null);
  useWindowViewStore.setState({ view, savedName: view === null ? null : savedName });
}

export function applyWindowViewSpec(spec: string): void {
  const { view, savedName } = parseWindowViewSpec(spec, useWindowViewStore.getState().savedViews);
  setWindowView(view, savedName);
}

export function currentWindowViewSpec(): string {
  const { view, savedName } = useWindowViewStore.getState();
  return windowViewSpec(view, savedName);
}

export function saveWindowView(name: string, color: WindowViewColor): void {
  const { view, savedViews } = useWindowViewStore.getState();
  if (view === null || name.trim() === "") return;
  const saved: SavedWindowView = { ...view, name: name.trim(), color };
  const others = savedViews.filter(
    (entry) => entry.name.toLowerCase() !== saved.name.toLowerCase(),
  );
  writeSavedViews([...others, saved]);
  useWindowViewStore.setState({ savedName: saved.name });
}

export function deleteSavedWindowView(name: string): void {
  writeSavedViews(useWindowViewStore.getState().savedViews.filter((entry) => entry.name !== name));
  if (useWindowViewStore.getState().savedName === name)
    useWindowViewStore.setState({ savedName: null });
}

function writeSavedViews(savedViews: readonly SavedWindowView[]): void {
  useWindowViewStore.setState({ savedViews });
  try {
    globalThis.localStorage?.setItem(SAVED_KEY, JSON.stringify(savedViews));
  } catch {
    // The views still apply in this window until it closes.
  }
}

export const canOpenWindows = (): boolean =>
  typeof window !== "undefined" && typeof window.desktopBridge?.openNewWindow === "function";

export function openWindowWithView(spec: string): void {
  void window.desktopBridge?.openNewWindow?.(spec || undefined);
}

if (typeof window !== "undefined") {
  useWindowViewStore.subscribe((state, previous) => {
    if (state.view === previous.view && state.savedName === previous.savedName) return;
    try {
      window.sessionStorage.setItem(
        CURRENT_KEY,
        JSON.stringify(state.view === null ? null : { ...state.view, savedName: state.savedName }),
      );
    } catch {
      // Only costs keeping the view across a reload.
    }
  });

  // A saved view this window shows stops naming it once its projects change.
  useWindowViewStore.subscribe((state) => {
    const saved = state.savedViews.find((entry) => entry.name === state.savedName);
    if (state.savedName !== null && !sameWindowView(state.view, saved ?? null)) {
      useWindowViewStore.setState({ savedName: null });
    }
  });

  // Picking one project in the sidebar's own filter replaces this window's view.
  useUiStateStore.subscribe((state, previous) => {
    if (
      state.sidebarProjectScopeKey !== previous.sidebarProjectScopeKey &&
      state.sidebarProjectScopeKey !== null
    ) {
      useWindowViewStore.setState({ view: null, savedName: null });
    }
  });

  // Saved views changed in another window.
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_KEY) useWindowViewStore.setState({ savedViews: readSavedViews() });
  });

  // A window opened with a view (New Window, a t3space:// link) applies it once.
  void window.desktopBridge
    ?.takeInitialWindowView?.()
    .then((spec) => {
      if (spec !== null) applyWindowViewSpec(spec);
    })
    .catch(() => undefined);

  // File > New Window: the new window starts with this window's view.
  window.desktopBridge?.onMenuAction?.((action) => {
    if (action === "new-window") openWindowWithView(currentWindowViewSpec());
  });

  // Window shortcuts (Settings > Keybindings > Windows) work from any window.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || !canOpenWindows()) return;
    const { savedViews } = useWindowViewStore.getState();
    const rows = windowKeybindingRows(savedViews, useWindowKeybindingsStore.getState().overrides);
    const id = resolveWindowKeybinding(event, rows, navigator.platform);
    if (id === null) return;
    event.preventDefault();
    if (id === "new-window") openWindowWithView(currentWindowViewSpec());
    else if (id === "view-menu") requestWindowViewMenu();
    else {
      const saved = savedViews.find((entry) => `view:${entry.name}` === id);
      if (saved) openWindowWithView(windowViewSpec(saved, saved.name));
    }
  });

  // The Dock menu lists the saved views.
  const syncDockViews = (savedViews: readonly SavedWindowView[]) =>
    void window.desktopBridge
      ?.setDockWindowViews?.(
        savedViews.map((saved) => ({ name: saved.name, view: windowViewSpec(saved, saved.name) })),
      )
      .catch(() => undefined);
  syncDockViews(useWindowViewStore.getState().savedViews);
  useWindowViewStore.subscribe((state, previous) => {
    if (state.savedViews !== previous.savedViews) syncDockViews(state.savedViews);
  });
}
