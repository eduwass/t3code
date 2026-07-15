import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
  UsersRoundIcon,
} from "lucide-react";

import { formatRelativeTimeLabel } from "../timestampFormat";
import { SidebarGroup } from "./ui/sidebar";

/**
 * AGENTSVIEW sidebar section — recent external agent sessions (last 7 days,
 * this machine, grouped by project, recent-first), served from the server's
 * warm cache (GET /api/external-sessions/recent). Clicking a row imports the
 * session (if needed) and opens its resumed thread.
 *
 * Collapsed and idle until first expanded; then it polls the cached endpoint.
 */

interface ExternalSessionRow {
  readonly provider: string;
  readonly nativeId: string;
  readonly title: string;
  readonly project: string;
  readonly agent: string;
  readonly machine: string;
  readonly lastActiveAt: string;
  readonly messageCount: number;
  readonly isTeammate: boolean;
}

interface ExternalSessionProjectGroup {
  readonly project: string;
  readonly sessions: ReadonlyArray<ExternalSessionRow>;
}

interface RecentSnapshot {
  readonly groups: ReadonlyArray<ExternalSessionProjectGroup>;
  readonly updatedAt: string | null;
  readonly available: boolean;
}

const POLL_MS = 30_000;

/**
 * Date-range filter over the warm 7-day cache. All options are within the
 * cached window, so filtering is client-side and instant; anything older is
 * reached via search ("Older than 7 days…"), not this dropdown.
 */
const RANGE_OPTIONS = [
  { days: 1, label: "Today" },
  { days: 3, label: "Last 3 days" },
  { days: 7, label: "Last 7 days" },
] as const;
const DEFAULT_RANGE_DAYS = 7;

/** Sessions shown per project before a "Show N older in <project>" reveal. */
const PROJECT_DISPLAY_CAP = 6;

/**
 * A session whose transcript was touched within this window is treated as
 * live/working and gets a green ring. The cache refreshes every 30s, so the
 * threshold is a little above that to avoid flicker between polls.
 */
const LIVE_THRESHOLD_MS = 90_000;

function isLiveSession(lastActiveAt: string): boolean {
  const at = Date.parse(lastActiveAt);
  return !Number.isNaN(at) && Date.now() - at < LIVE_THRESHOLD_MS;
}

const AGENT_DOT: Record<string, string> = {
  claude: "bg-blue-500",
  codex: "bg-green-500",
  opencode: "bg-purple-500",
};

const AGENT_TEXT: Record<string, string> = {
  claude: "text-blue-500",
  codex: "text-green-500",
  opencode: "text-purple-500",
};

function SessionRow({
  row,
  busy,
  onOpen,
}: {
  readonly row: ExternalSessionRow;
  readonly busy: boolean;
  readonly onOpen: (row: ExternalSessionRow) => void;
}) {
  const live = isLiveSession(row.lastActiveAt);
  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 rounded-md py-1 pl-7 pr-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
      onClick={() => onOpen(row)}
      disabled={busy}
      title={row.title}
    >
      <span
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${AGENT_DOT[row.agent] ?? "bg-muted-foreground"} ${
          live ? "ring-2 ring-green-500 ring-offset-1 ring-offset-background" : ""
        }`}
        title={live ? "Live / working" : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">
          {row.title || "Untitled session"}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <span>{formatRelativeTimeLabel(row.lastActiveAt)}</span>
          {row.messageCount > 0 ? (
            <>
              <span>·</span>
              <span className="tabular-nums">•{row.messageCount}</span>
            </>
          ) : null}
          {row.isTeammate ? <UsersRoundIcon className="size-3 text-muted-foreground/50" /> : null}
        </span>
      </span>
      <span
        className={`mt-0.5 shrink-0 text-[9px] font-medium uppercase tracking-wide ${
          AGENT_TEXT[row.agent] ?? "text-muted-foreground"
        }`}
      >
        {row.provider}
      </span>
    </button>
  );
}

function useRecentExternalSessions(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<RecentSnapshot | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/external-sessions/recent", {
          credentials: "include",
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = (await response.json()) as RecentSnapshot;
        if (!cancelled) {
          setSnapshot(data);
          setErrored(false);
        }
      } catch {
        if (!cancelled) setErrored(true);
      }
    };
    void load();
    const interval = setInterval(load, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled]);

  return { snapshot, errored };
}

export function AgentsviewSection() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(new Set());
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<number>(DEFAULT_RANGE_DAYS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ReadonlyArray<ExternalSessionRow> | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const resumeInFlight = useRef(false);
  const foldedSeeded = useRef(false);
  const { snapshot, errored } = useRecentExternalSessions(expanded);

  // On first expand, start with every project folded — the section opens as a
  // compact list of project headers. After that the user's toggles stick.
  useEffect(() => {
    if (!expanded || foldedSeeded.current || !snapshot) return;
    foldedSeeded.current = true;
    setCollapsedProjects(new Set(snapshot.groups.map((group) => group.project)));
  }, [expanded, snapshot]);

  // Debounced full-text search (the slow path beyond the 7-day cache).
  useEffect(() => {
    if (!searchOpen) return;
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/external-sessions/search?q=${encodeURIComponent(query)}`,
          { credentials: "include" },
        );
        const data = response.ok
          ? ((await response.json()) as { sessions?: ReadonlyArray<ExternalSessionRow> })
          : { sessions: [] };
        if (!cancelled) setSearchResults(data.sessions ?? []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchOpen, searchQuery]);

  const toggleProject = useCallback((project: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  }, []);

  const revealProject = useCallback((project: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(project);
      return next;
    });
  }, []);

  const openSession = useCallback(
    async (row: ExternalSessionRow) => {
      if (resumeInFlight.current) return;
      resumeInFlight.current = true;
      setResumingId(row.nativeId);
      try {
        // The resume endpoint imports (if needed) and 302s to /<env>/<thread>;
        // follow it, then hand the resolved thread route to the SPA router so
        // we land on the thread without a full reload.
        const response = await fetch(
          `/api/resume/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.nativeId)}`,
          { credentials: "include" },
        );
        if (response.redirected) {
          const path = new URL(response.url).pathname;
          const segments = path.split("/").filter((segment) => segment.length > 0);
          if (segments.length >= 2) {
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId: segments[0]!, threadId: segments[1]! },
            });
          }
        }
      } catch {
        // Swallow — a failed resume just leaves the section as-is.
      } finally {
        resumeInFlight.current = false;
        setResumingId(null);
      }
    },
    [router],
  );

  const rawGroups = snapshot?.groups ?? [];
  const cutoff = Date.now() - rangeDays * 86_400_000;
  const groups =
    rangeDays >= DEFAULT_RANGE_DAYS
      ? rawGroups
      : rawGroups
          .map((group) => ({
            ...group,
            sessions: group.sessions.filter((row) => {
              const at = Date.parse(row.lastActiveAt);
              return Number.isNaN(at) || at >= cutoff;
            }),
          }))
          .filter((group) => group.sessions.length > 0);
  const totalSessions = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const activeRangeLabel =
    RANGE_OPTIONS.find((option) => option.days === rangeDays)?.label ?? "Last 7 days";

  return (
    <SidebarGroup className="px-2 py-2">
      <button
        type="button"
        className="mb-1 flex w-full items-center gap-1.5 pl-2 pr-1.5 text-muted-foreground/60 transition-colors hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider">Agentsview</span>
        {expanded && totalSessions > 0 ? (
          <span className="ml-auto text-[10px] tabular-nums">{totalSessions}</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="flex flex-col">
          <div className="mb-1 flex items-center justify-end px-2">
            <select
              value={rangeDays}
              onChange={(event) => setRangeDays(Number(event.target.value))}
              className="cursor-pointer rounded border border-border/60 bg-transparent py-0.5 pl-1 pr-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
              aria-label="Filter by date range"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.days} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {snapshot === null && !errored ? (
            <div className="px-2 py-2 text-xs text-muted-foreground/60">Loading…</div>
          ) : errored || snapshot?.available === false ? (
            <div className="px-2 py-2 text-xs text-muted-foreground/60">
              agentsview not reachable
            </div>
          ) : groups.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground/60">
              No sessions ({activeRangeLabel.toLowerCase()})
            </div>
          ) : (
            groups.map((group) => {
              const projectCollapsed = collapsedProjects.has(group.project);
              return (
                <div key={group.project} className="mb-0.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => toggleProject(group.project)}
                  >
                    {projectCollapsed ? (
                      <ChevronRightIcon className="size-3 shrink-0" />
                    ) : (
                      <ChevronDownIcon className="size-3 shrink-0" />
                    )}
                    <FolderIcon className="size-3 shrink-0" />
                    <span className="truncate">{group.project}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground/60">
                      {group.sessions.length}
                    </span>
                  </button>
                  {projectCollapsed
                    ? null
                    : (() => {
                        const showAll = expandedProjects.has(group.project);
                        const visible = showAll
                          ? group.sessions
                          : group.sessions.slice(0, PROJECT_DISPLAY_CAP);
                        const hidden = group.sessions.length - visible.length;
                        return (
                          <>
                            {visible.map((row) => (
                              <SessionRow
                                key={`${row.provider}:${row.nativeId}`}
                                row={row}
                                busy={resumingId === row.nativeId}
                                onOpen={openSession}
                              />
                            ))}
                            {hidden > 0 ? (
                              <button
                                type="button"
                                className="w-full rounded-md py-1 pl-7 pr-2 text-left text-[11px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                                onClick={() => revealProject(group.project)}
                              >
                                Show {hidden} older in {group.project}
                              </button>
                            ) : null}
                          </>
                        );
                      })()}
                </div>
              );
            })
          )}

          {/* Older than 7 days → full-text search (the slow path). */}
          <div className="mt-1 border-t border-border/40 pt-1">
            {searchOpen ? (
              <>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search all sessions…"
                  className="mb-1 w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                {searching ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground/60">Searching…</div>
                ) : searchResults === null ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground/50">
                    Type to search older sessions
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground/60">No matches</div>
                ) : (
                  searchResults.map((row) => (
                    <SessionRow
                      key={`search:${row.provider}:${row.nativeId}`}
                      row={row}
                      busy={resumingId === row.nativeId}
                      onOpen={openSession}
                    />
                  ))
                )}
              </>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setSearchOpen(true)}
              >
                <SearchIcon className="size-3 shrink-0" />
                Older than 7 days…
              </button>
            )}
          </div>
        </div>
      ) : null}
    </SidebarGroup>
  );
}
