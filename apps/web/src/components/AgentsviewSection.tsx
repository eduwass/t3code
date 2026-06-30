import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, UsersRoundIcon } from "lucide-react";

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
  const [resumingId, setResumingId] = useState<string | null>(null);
  const resumeInFlight = useRef(false);
  const { snapshot, errored } = useRecentExternalSessions(expanded);

  const toggleProject = useCallback((project: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
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

  const groups = snapshot?.groups ?? [];
  const totalSessions = groups.reduce((sum, group) => sum + group.sessions.length, 0);

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
          {snapshot === null && !errored ? (
            <div className="px-2 py-2 text-xs text-muted-foreground/60">Loading…</div>
          ) : errored || snapshot?.available === false ? (
            <div className="px-2 py-2 text-xs text-muted-foreground/60">
              agentsview not reachable
            </div>
          ) : groups.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground/60">
              No recent sessions (last 7 days)
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
                    : group.sessions.map((row) => (
                        <button
                          key={`${row.provider}:${row.nativeId}`}
                          type="button"
                          className="flex w-full items-start gap-2 rounded-md py-1 pl-7 pr-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
                          onClick={() => void openSession(row)}
                          disabled={resumingId === row.nativeId}
                          title={row.title}
                        >
                          <span
                            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                              AGENT_DOT[row.agent] ?? "bg-muted-foreground"
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-foreground">
                              {row.title || "Untitled session"}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                              <span>{formatRelativeTimeLabel(row.lastActiveAt)}</span>
                              <span>·</span>
                              <span className="tabular-nums">•{row.messageCount}</span>
                              {row.isTeammate ? (
                                <UsersRoundIcon className="size-3 text-muted-foreground/50" />
                              ) : null}
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
                      ))}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </SidebarGroup>
  );
}
