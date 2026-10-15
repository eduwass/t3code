// The sidebar project scope belongs to one window, so several desktop windows can
// each show their own projects. sessionStorage is per window and survives a reload;
// a new window starts from the scope last chosen in any window (localStorage).
const WINDOW_PROJECT_SCOPE_KEY = "t3code:window-sidebar-project-scope:v1";

type ScopeStorage = Pick<Storage, "getItem" | "setItem">;

const sessionStorageOrNull = (): ScopeStorage | null =>
  typeof window === "undefined" ? null : window.sessionStorage;

export function withWindowProjectScope<State extends { sidebarProjectScopeKeys: string[] }>(
  state: State,
  storage: ScopeStorage | null = sessionStorageOrNull(),
): State {
  try {
    const raw = storage?.getItem(WINDOW_PROJECT_SCOPE_KEY);
    if (raw == null) return state;
    const stored: unknown = JSON.parse(raw);
    // Builds before multi-project scopes stored one key or null.
    const keys =
      stored === null
        ? []
        : typeof stored === "string"
          ? [stored]
          : Array.isArray(stored) && stored.every((key) => typeof key === "string")
            ? stored
            : null;
    return keys === null ? state : { ...state, sidebarProjectScopeKeys: keys };
  } catch {
    return state;
  }
}

export function rememberWindowProjectScope(
  keys: readonly string[],
  storage: ScopeStorage | null = sessionStorageOrNull(),
): void {
  try {
    storage?.setItem(WINDOW_PROJECT_SCOPE_KEY, JSON.stringify(keys));
  } catch {
    // Storage errors only cost the per-window scope; the shared one still persists.
  }
}
