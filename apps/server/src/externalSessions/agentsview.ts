/**
 * Shared agentsview daemon access: base URL resolution, loopback-only URL
 * building, and the set of providers whose sessions T3 can resume.
 *
 * @module externalSessions/agentsview
 */

/** Providers whose external sessions T3 can resume (URL token === agentsview agent). */
export const SUPPORTED_EXTERNAL_PROVIDERS = ["claude", "codex", "opencode"] as const;

export const AGENTSVIEW_BASE_URL = process.env.AGENTSVIEW_URL ?? "http://127.0.0.1:18080";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** Build an agentsview request URL, enforcing a loopback-only daemon. */
export function agentsviewUrl(pathname: string, search?: string): string | undefined {
  let base: URL;
  try {
    base = new URL(AGENTSVIEW_BASE_URL);
  } catch {
    return undefined;
  }
  if (!LOOPBACK_HOSTNAMES.has(base.hostname)) {
    return undefined;
  }
  base.pathname = pathname;
  base.search = search ?? "";
  base.hash = "";
  return base.toString();
}

export function agentsviewSessionUrl(agentsviewId: string): string | undefined {
  return agentsviewUrl(`/api/v1/sessions/${encodeURIComponent(agentsviewId)}`);
}

export function agentsviewSessionMessagesUrl(
  agentsviewId: string,
  search: string,
): string | undefined {
  return agentsviewUrl(`/api/v1/sessions/${encodeURIComponent(agentsviewId)}/messages`, search);
}

/** Build a `/api/v1/sessions` list URL from a flat param map. */
export function agentsviewListUrl(params: Record<string, string>): string | undefined {
  const search = new URLSearchParams(params).toString();
  return agentsviewUrl("/api/v1/sessions", search);
}

/** Build a `/api/v1/search` full-text search URL. */
export function agentsviewSearchUrl(params: Record<string, string>): string | undefined {
  const search = new URLSearchParams(params).toString();
  return agentsviewUrl("/api/v1/search", search);
}
