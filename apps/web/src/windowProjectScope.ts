// The sidebar project scope belongs to one window, so several desktop windows can
// each show their own project. sessionStorage is per window and survives a reload;
// a new window starts from the scope last chosen in any window (localStorage).
const WINDOW_PROJECT_SCOPE_KEY = "t3code:window-sidebar-project-scope:v1";

type ScopeStorage = Pick<Storage, "getItem" | "setItem">;

const sessionStorageOrNull = (): ScopeStorage | null =>
  typeof window === "undefined" ? null : window.sessionStorage;

export function withWindowProjectScope<State extends { sidebarProjectScopeKey: string | null }>(
  state: State,
  storage: ScopeStorage | null = sessionStorageOrNull(),
): State {
  try {
    const raw = storage?.getItem(WINDOW_PROJECT_SCOPE_KEY);
    if (raw == null) return state;
    const key: unknown = JSON.parse(raw);
    return typeof key === "string" || key === null
      ? { ...state, sidebarProjectScopeKey: key }
      : state;
  } catch {
    return state;
  }
}

export function rememberWindowProjectScope(
  key: string | null,
  storage: ScopeStorage | null = sessionStorageOrNull(),
): void {
  try {
    storage?.setItem(WINDOW_PROJECT_SCOPE_KEY, JSON.stringify(key));
  } catch {
    // Storage errors only cost the per-window scope; the shared one still persists.
  }
}
