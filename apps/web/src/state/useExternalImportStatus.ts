import { useEffect, useState } from "react";

/**
 * Polls the server for external-session imports that are still hydrating in the
 * background, so a freshly-opened (resumed) thread can show an "Importing…"
 * affordance instead of treating its partially-built content as final. Polling
 * stops once the given thread is no longer importing.
 */
export function useExternalImportStatus(threadId: string | null): boolean {
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!threadId) {
      setImporting(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch("/api/external-sessions/import-status", {
          credentials: "include",
        });
        if (response.ok) {
          const body = (await response.json()) as { threadIds?: ReadonlyArray<string> };
          const active = Array.isArray(body.threadIds) && body.threadIds.includes(threadId);
          if (!cancelled) {
            setImporting(active);
            // Keep polling only while this thread is still importing.
            if (active) timer = setTimeout(() => void poll(), 1500);
          }
          return;
        }
      } catch {
        // Ignore — a failed status check just hides the affordance.
      }
      if (!cancelled) setImporting(false);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [threadId]);

  return importing;
}
