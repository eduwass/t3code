import { useEffect } from "react";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { windowViewGroups, windowViewProjectKeys } from "./windowView.logic";
import { useWindowViewStore } from "./windowViewStore";

/**
 * The project keys the sidebar shows: this window's view when it has one, else
 * the sidebar's own single-project scope. Publishes the groups and their thread
 * counts for the view menu.
 */
export function useWindowViewProjectKeys(
  groups: readonly SidebarProjectSnapshot[],
  singleProjectKeys: ReadonlySet<string> | null,
  threads: ReadonlyArray<{ readonly environmentId: string; readonly projectId: string }>,
): ReadonlySet<string> | null {
  const view = useWindowViewStore((state) => state.view);
  useEffect(() => {
    useWindowViewStore.setState({ groups });
  }, [groups]);
  useEffect(() => {
    const groupByProject = new Map<string, string>();
    for (const group of groups) {
      for (const ref of group.memberProjectRefs) {
        groupByProject.set(`${ref.environmentId}:${ref.projectId}`, group.projectKey);
      }
    }
    const counts = new Map<string, number>();
    for (const thread of threads) {
      const key = groupByProject.get(`${thread.environmentId}:${thread.projectId}`);
      if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Threads change on every streamed update; only a different count re-renders the menu.
    const previous = useWindowViewStore.getState().threadCounts;
    const changed =
      counts.size !== previous.size ||
      [...counts].some(([key, count]) => previous.get(key) !== count);
    if (changed) useWindowViewStore.setState({ threadCounts: counts });
  }, [groups, threads]);
  return view === null ? singleProjectKeys : windowViewProjectKeys(view, groups);
}

/** The project groups this window's view offers; every group without a view. */
export function useWindowViewGroups<Group extends { readonly displayName: string }>(
  groups: readonly Group[],
): readonly Group[] {
  const view = useWindowViewStore((state) => state.view);
  return windowViewGroups(view, groups);
}
