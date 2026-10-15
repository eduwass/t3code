// A window view decides which projects a T3 Space window's sidebar shows: only
// some, or all except some. Projects are named by their sidebar label, matched
// without case, so a view survives restarts and fits in a link:
//   t3space://window?only=goldflower,eventintel   (or except=…, or view=Work)

export type WindowViewMode = "only" | "except";

export interface WindowView {
  readonly mode: WindowViewMode;
  readonly projects: readonly string[];
}

export const WINDOW_VIEW_COLORS = {
  blue: "#4f6bed",
  green: "#3fb27f",
  amber: "#e0a63a",
  rose: "#e05a7a",
  violet: "#9a6be8",
  teal: "#2fb3b3",
  orange: "#e5793b",
  slate: "#8a94a6",
} as const;

export type WindowViewColor = keyof typeof WINDOW_VIEW_COLORS;

export interface SavedWindowView extends WindowView {
  readonly name: string;
  readonly color: WindowViewColor;
}

export interface WindowViewProjectGroup {
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
  }>;
}

const fold = (name: string) => name.trim().toLowerCase();

export const isWindowViewColor = (value: unknown): value is WindowViewColor =>
  typeof value === "string" && Object.hasOwn(WINDOW_VIEW_COLORS, value);

/** Drops blanks and duplicates; a view that picks nothing shows everything (null). */
export function normalizeWindowView(view: WindowView): WindowView | null {
  const seen = new Set<string>();
  const projects = view.projects.filter((name) => {
    const key = fold(name);
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return projects.length === 0
    ? null
    : { mode: view.mode, projects: projects.map((name) => name.trim()) };
}

export function sameWindowView(a: WindowView | null, b: WindowView | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.mode !== b.mode || a.projects.length !== b.projects.length) return false;
  const names = new Set(a.projects.map(fold));
  return b.projects.every((name) => names.has(fold(name)));
}

export interface ParsedWindowView {
  readonly view: WindowView | null;
  readonly savedName: string | null;
}

/** Reads a link's query ("only=a,b", "except=a", "view=Work"); unknown input shows everything. */
export function parseWindowViewSpec(
  spec: string,
  savedViews: readonly SavedWindowView[],
): ParsedWindowView {
  const params = new URLSearchParams(spec);
  const list = (value: string) => value.split(",");
  const name = params.get("view");
  if (name !== null) {
    const saved = savedViews.find((candidate) => fold(candidate.name) === fold(name));
    return saved
      ? { view: normalizeWindowView(saved), savedName: saved.name }
      : { view: null, savedName: null };
  }
  const except = params.get("except");
  if (except !== null) {
    return {
      view: normalizeWindowView({ mode: "except", projects: list(except) }),
      savedName: null,
    };
  }
  const only = params.get("only") ?? params.get("project");
  if (only !== null) {
    return { view: normalizeWindowView({ mode: "only", projects: list(only) }), savedName: null };
  }
  return { view: null, savedName: null };
}

/** The link query for a view, the inverse of parseWindowViewSpec. */
export function windowViewSpec(view: WindowView | null, savedName: string | null): string {
  if (savedName !== null) return new URLSearchParams({ view: savedName }).toString();
  if (view === null) return "";
  return `${view.mode}=${view.projects.map(encodeURIComponent).join(",")}`;
}

/** The `environmentId:projectId` keys the sidebar shows, or null for everything. */
export function windowViewProjectKeys(
  view: WindowView | null,
  groups: readonly WindowViewProjectGroup[],
): ReadonlySet<string> | null {
  if (view === null) return null;
  const named = new Set(view.projects.map(fold));
  const keys = new Set<string>();
  for (const group of groups) {
    if (named.has(fold(group.displayName)) !== (view.mode === "only")) continue;
    for (const ref of group.memberProjectRefs) keys.add(`${ref.environmentId}:${ref.projectId}`);
  }
  return keys;
}

/** The groups a window with this view offers, such as for "New thread in…". */
export function windowViewGroups<Group extends { readonly displayName: string }>(
  view: WindowView | null,
  groups: readonly Group[],
): readonly Group[] {
  if (view === null) return groups;
  const named = new Set(view.projects.map(fold));
  return groups.filter((group) => named.has(fold(group.displayName)) === (view.mode === "only"));
}

export function toggleWindowViewProject(
  view: WindowView | null,
  mode: WindowViewMode,
  project: string,
): WindowView | null {
  const projects = view?.mode === mode ? view.projects : [];
  const included = projects.some((name) => fold(name) === fold(project));
  return normalizeWindowView({
    mode,
    projects: included
      ? projects.filter((name) => fold(name) !== fold(project))
      : [...projects, project],
  });
}

export function describeWindowView(view: WindowView | null, savedName: string | null): string {
  if (savedName !== null) return savedName;
  if (view === null) return "All projects";
  const [first, ...rest] = view.projects;
  const names = rest.length === 0 ? first : `${first} +${rest.length}`;
  return view.mode === "only" ? `${names}` : `All except ${names}`;
}

/** A stable color for an unsaved view, so the same projects always look the same. */
export function windowViewColor(
  view: WindowView | null,
  saved: SavedWindowView | null,
): string | null {
  if (saved !== null) return WINDOW_VIEW_COLORS[saved.color];
  if (view === null) return null;
  const key = `${view.mode}:${view.projects.map(fold).toSorted().join(",")}`;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const colors = Object.values(WINDOW_VIEW_COLORS);
  return colors[hash % colors.length] ?? null;
}
