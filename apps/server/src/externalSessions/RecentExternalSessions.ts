/**
 * RecentExternalSessions — a warm, server-side cache of recent external agent
 * sessions for the AGENTSVIEW sidebar section.
 *
 * The default sidebar view is "sessions from the last 7 days, on this machine,
 * grouped by project, ordered by last-interacted" — the 90% path. We keep that
 * exact slice cached in memory (refreshed on a short interval) so the section
 * paints instantly and never blocks on the agentsview daemon. Anything outside
 * this window is fetched live (pagination within a project, or search) and does
 * not go through this cache.
 *
 * Stale-while-revalidate: `get` always returns the last good snapshot; a
 * background fiber refreshes it. If agentsview is unreachable the snapshot is
 * marked unavailable but the last good data is retained.
 *
 * @module RecentExternalSessions
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import { HttpClient } from "effect/unstable/http";

import {
  agentsviewListUrl,
  agentsviewSearchUrl,
  SUPPORTED_EXTERNAL_PROVIDERS,
} from "./agentsview.ts";

const WINDOW_DAYS = 7;
const REFRESH_INTERVAL = Duration.seconds(30);
const FETCH_LIMIT = 200;
const MAX_PER_PROJECT = 12;
const SEARCH_LIMIT = 50;
const AGENTSVIEW_TIMEOUT = "5 seconds";

const SUPPORTED = new Set<string>(SUPPORTED_EXTERNAL_PROVIDERS);

export interface ExternalSessionRow {
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

export interface ExternalSessionProjectGroup {
  readonly project: string;
  readonly sessions: ReadonlyArray<ExternalSessionRow>;
}

export interface RecentExternalSessionsSnapshot {
  readonly groups: ReadonlyArray<ExternalSessionProjectGroup>;
  readonly updatedAt: string | null;
  readonly available: boolean;
}

const EMPTY: RecentExternalSessionsSnapshot = { groups: [], updatedAt: null, available: false };

export class RecentExternalSessions extends Context.Service<
  RecentExternalSessions,
  {
    /** Last good snapshot — returns instantly, never blocks on agentsview. */
    readonly get: Effect.Effect<RecentExternalSessionsSnapshot>;
    /** Force a refresh now (also runs automatically in the background). */
    readonly refresh: Effect.Effect<void>;
    /** Full-text search across all sessions (slow path, beyond the 7-day cache). */
    readonly search: (query: string) => Effect.Effect<ReadonlyArray<ExternalSessionRow>>;
  }
>()("t3/externalSessions/RecentExternalSessions") {}

function toRow(entry: unknown): ExternalSessionRow | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  const agent = typeof record.agent === "string" ? record.agent : "";
  if (!SUPPORTED.has(agent)) return undefined;
  const id = typeof record.id === "string" ? record.id : "";
  const sourceId = typeof record.source_session_id === "string" ? record.source_session_id : "";
  const nativeId =
    sourceId.length > 0 ? sourceId : id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  if (nativeId.length === 0) return undefined;
  const project =
    typeof record.project === "string" && record.project.length > 0 ? record.project : "(unknown)";
  const lastActiveAt =
    typeof record.ended_at === "string"
      ? record.ended_at
      : typeof record.started_at === "string"
        ? record.started_at
        : "";
  return {
    provider: agent,
    nativeId,
    title: typeof record.first_message === "string" ? record.first_message : "",
    project,
    agent,
    machine: typeof record.machine === "string" ? record.machine : "",
    lastActiveAt,
    messageCount: typeof record.message_count === "number" ? record.message_count : 0,
    isTeammate: record.is_teammate === true,
  };
}

/** Map an agentsview `/api/v1/search` result row to a session row. */
function searchResultToRow(entry: unknown): ExternalSessionRow | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  const agent = typeof record.agent === "string" ? record.agent : "";
  if (!SUPPORTED.has(agent)) return undefined;
  const sessionId = typeof record.session_id === "string" ? record.session_id : "";
  const nativeId = sessionId.includes(":")
    ? sessionId.slice(sessionId.indexOf(":") + 1)
    : sessionId;
  if (nativeId.length === 0) return undefined;
  return {
    provider: agent,
    nativeId,
    title: typeof record.name === "string" ? record.name : "",
    project:
      typeof record.project === "string" && record.project.length > 0
        ? record.project
        : "(unknown)",
    agent,
    machine: "",
    lastActiveAt: typeof record.session_ended_at === "string" ? record.session_ended_at : "",
    // Search results carry a match ordinal, not a reliable total — omit count.
    messageCount: 0,
    isTeammate: false,
  };
}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const cache = yield* Ref.make<RecentExternalSessionsSnapshot>(EMPTY);

  const refresh = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const since = DateTime.formatIso(DateTime.subtract(now, { days: WINDOW_DAYS }));
    const url = agentsviewListUrl({
      machine: "local",
      active_since: since,
      order_by: "recent",
      descending: "true",
      limit: String(FETCH_LIMIT),
    });
    if (url === undefined) {
      yield* Ref.update(cache, (prev) => ({ ...prev, available: false }));
      return;
    }
    const response = yield* httpClient.get(url).pipe(Effect.timeout(AGENTSVIEW_TIMEOUT));
    if (response.status !== 200) {
      yield* Ref.update(cache, (prev) => ({ ...prev, available: false }));
      return;
    }
    const raw = (yield* response.json) as { readonly sessions?: ReadonlyArray<unknown> };
    const rows = Array.isArray(raw.sessions) ? raw.sessions : [];
    const order: Array<string> = [];
    const byProject = new Map<string, Array<ExternalSessionRow>>();
    for (const entry of rows) {
      const row = toRow(entry);
      if (row === undefined) continue;
      let bucket = byProject.get(row.project);
      if (bucket === undefined) {
        bucket = [];
        byProject.set(row.project, bucket);
        order.push(row.project);
      }
      if (bucket.length < MAX_PER_PROJECT) bucket.push(row);
    }
    const groups = order.map((project) => ({ project, sessions: byProject.get(project) ?? [] }));
    yield* Ref.set(cache, { groups, updatedAt: DateTime.formatIso(now), available: true });
  }).pipe(
    // A failed refresh keeps the last good snapshot; just mark it unavailable.
    Effect.catchCause(() => Ref.update(cache, (prev) => ({ ...prev, available: false }))),
  );

  // Full-text search across all sessions (the slow path, beyond the warm 7-day
  // window). Returns a flat, supported-provider, recent-first row list. Any
  // failure yields an empty list — search is best-effort.
  const search = (query: string) =>
    Effect.gen(function* () {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [] as ReadonlyArray<ExternalSessionRow>;
      const url = agentsviewSearchUrl({ q: trimmed, limit: String(SEARCH_LIMIT) });
      if (url === undefined) return [] as ReadonlyArray<ExternalSessionRow>;
      const response = yield* httpClient.get(url).pipe(Effect.timeout(AGENTSVIEW_TIMEOUT));
      if (response.status !== 200) return [] as ReadonlyArray<ExternalSessionRow>;
      const raw = (yield* response.json) as { readonly results?: ReadonlyArray<unknown> };
      const results = Array.isArray(raw.results) ? raw.results : [];
      const rows: Array<ExternalSessionRow> = [];
      for (const entry of results) {
        const row = searchResultToRow(entry);
        if (row !== undefined) rows.push(row);
      }
      return rows;
    }).pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<ExternalSessionRow>)));

  // Warm immediately, then refresh on a fixed cadence for the session lifetime.
  yield* Effect.forkScoped(refresh.pipe(Effect.repeat(Schedule.spaced(REFRESH_INTERVAL))));

  return { get: Ref.get(cache), refresh, search } as const;
});

export const layer = Layer.effect(RecentExternalSessions, make);
