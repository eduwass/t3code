import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteRef } from "../threadRoutes";
import { SidebarInset } from "~/components/ui/sidebar";
import { useEnvironmentThreadRefs, useThreadDetail, useThreadShell } from "../state/entities";
import { useExternalImportStatus } from "../state/useExternalImportStatus";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const shell = useEnvironmentQuery(
    threadRef === null ? null : environmentShell.stateAtom(threadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(threadRef);
  const serverThreadDetail = useThreadDetail(threadRef);
  const environmentThreadRefs = useEnvironmentThreadRefs(threadRef?.environmentId ?? null);
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const threadExists = serverThreadShell !== null || serverThreadDetail !== null;
  const environmentHasServerThreads = environmentThreadRefs.length > 0;
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThreadDetail);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  return (
    <SidebarInset className="relative h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ImportingBanner threadId={threadRef.threadId} />
      <ChatView
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        routeKind="server"
      />
    </SidebarInset>
  );
}

/**
 * Thin banner shown while a resumed external session is still hydrating in the
 * background — the conversation streams in live, so this signals the content is
 * still being imported rather than final.
 */
function ImportingBanner({ threadId }: { readonly threadId: string }) {
  const importing = useExternalImportStatus(threadId);
  if (!importing) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-2">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
        <span className="size-2 animate-pulse rounded-full bg-blue-500" />
        Importing conversation…
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
});
