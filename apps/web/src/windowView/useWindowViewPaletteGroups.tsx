import { AppWindowIcon, ListChecksIcon } from "lucide-react";

import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
} from "../components/CommandPalette.logic";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { CommandShortcut } from "../components/ui/command";
import { useWindowShortcutLabels } from "./WindowViewMenu";
import { WINDOW_VIEW_COLORS, windowViewSpec } from "./windowView.logic";
import {
  canOpenWindows,
  currentWindowViewSpec,
  openWindowWithView,
  requestWindowViewMenu,
  useWindowViewStore,
} from "./windowViewStore";

const shortcutContent = (label: string | null | undefined) =>
  label ? <CommandShortcut>{label}</CommandShortcut> : undefined;

/**
 * The palette's "New window" sections: saved views first, then each project on
 * its own, then a window like this one or with projects picked in the view menu.
 */
export function useWindowViewPaletteGroups(): CommandPaletteGroup[] {
  const savedViews = useWindowViewStore((state) => state.savedViews);
  const groups = useWindowViewStore((state) => state.groups);
  const shortcuts = useWindowShortcutLabels();
    if (!canOpenWindows()) return [];
    const windowIcon = <AppWindowIcon className={ITEM_ICON_CLASS} />;
    const savedItems = savedViews.map((saved): CommandPaletteActionItem => {
      const shortcut = shortcutContent(shortcuts.get(`view:${saved.name}`));
      return {
        kind: "action",
        value: `window:view:${saved.name}`,
        searchTerms: ["new window", "window", "view", saved.name, ...saved.projects],
        title: saved.name,
        description: `${saved.mode === "only" ? "" : "All except "}${saved.projects.join(", ")}`,
        icon: (
          <span className="flex size-4 shrink-0 items-center justify-center">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: WINDOW_VIEW_COLORS[saved.color] }}
            />
          </span>
        ),
        ...(shortcut ? { titleTrailingContent: shortcut } : {}),
        run: async () => openWindowWithView(windowViewSpec(saved, saved.name)),
      };
    });
    const projectItems = groups.map((group): CommandPaletteActionItem => ({
      kind: "action",
      value: `window:project:${group.projectKey}`,
      searchTerms: ["new window", "window", group.displayName],
      title: `New window: ${group.displayName}`,
      icon: <ProjectFavicon project={group} className="size-4 shrink-0" />,
      run: async () =>
        openWindowWithView(windowViewSpec({ mode: "only", projects: [group.displayName] }, null)),
    }));
    const newWindowShortcut = shortcutContent(shortcuts.get("new-window"));
    const otherItems: CommandPaletteActionItem[] = [
      {
        kind: "action",
        value: "window:new",
        searchTerms: ["new window", "window"],
        title: "New window with this window's view",
        icon: windowIcon,
        ...(newWindowShortcut ? { titleTrailingContent: newWindowShortcut } : {}),
        run: async () => openWindowWithView(currentWindowViewSpec()),
      },
      {
        kind: "action",
        value: "window:pick",
        searchTerms: ["new window", "window", "pick projects", "view"],
        title: "New window with… pick projects",
        icon: <ListChecksIcon className={ITEM_ICON_CLASS} />,
        run: async () => requestWindowViewMenu(),
      },
    ];
    return [
      ...(savedItems.length > 0
        ? [{ value: "window-views", label: "Saved views", items: savedItems }]
        : []),
      ...(projectItems.length > 0
        ? [{ value: "window-projects", label: "Just one project", items: projectItems }]
        : []),
      { value: "window-new", label: "New window", items: otherItems },
    ];
}
