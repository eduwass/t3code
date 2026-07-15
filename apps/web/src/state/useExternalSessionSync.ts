import { useEffect } from "react";

/** How often to poll for newer transcript messages on the open thread. */
const SYNC_INTERVAL_MS = 4_000;

/**
 * While a thread is open, periodically asks the server to sync it with its
 * on-disk transcript — so a session worked on elsewhere (e.g. the CLI) shows
 * its newer messages without a manual re-import. The endpoint is a cheap no-op
 * for threads that aren't sync-eligible imports, and new messages stream into
 * the open thread live, so this hook just fires the tick and ignores the result.
 */
export function useExternalSessionSync(threadId: string | null): void {
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        await fetch(`/api/external-sessions/sync?threadId=${encodeURIComponent(threadId)}`, {
          credentials: "include",
        });
      } catch {
        // Ignore — sync is best-effort; the thread keeps its current content.
      }
      if (!cancelled) timer = setTimeout(() => void tick(), SYNC_INTERVAL_MS);
    };

    // Sync immediately on open so re-opening a thread catches up at once (a
    // still-running initial import just no-ops until its marker is set).
    void tick();
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [threadId]);
}
