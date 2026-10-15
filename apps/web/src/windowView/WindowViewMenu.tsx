import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";
import { AppWindowIcon, XIcon } from "lucide-react";
import { useEffect, useState, type SyntheticEvent } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Kbd } from "../components/ui/kbd";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { formatShortcutLabel } from "../keybindings";
import {
  WINDOW_VIEW_COLORS,
  describeWindowView,
  isWindowViewColor,
  toggleWindowViewProject,
  windowViewColor,
  windowViewSpec,
  type WindowViewColor,
} from "./windowView.logic";
import { useWindowKeybindingsStore, windowKeybindingRows } from "./windowKeybindings";
import {
  canOpenWindows,
  currentWindowViewSpec,
  deleteSavedWindowView,
  openWindowWithView,
  closeWindowViewMenu,
  requestWindowViewMenu,
  saveWindowView,
  setWindowView,
  useWindowViewStore,
} from "./windowViewStore";

// The window view's pieces inside the sidebar's own project filter menu, plus
// the dot next to the wordmark that always shows which view this window has.

/** The label for a stored shortcut such as `mod+ctrl+1`, or null when unassigned. */
export function windowShortcutLabel(key: string): string | null {
  const shortcut = key === "" ? null : parseKeybindingShortcut(key);
  return shortcut === null ? null : formatShortcutLabel(shortcut);
}

/** The shortcut labels for each window command, by keybinding id. */
export function useWindowShortcutLabels(): ReadonlyMap<string, string | null> {
  const savedViews = useWindowViewStore((state) => state.savedViews);
  const overrides = useWindowKeybindingsStore((state) => state.overrides);
  return new Map(
    windowKeybindingRows(savedViews, overrides).map((row) => [row.id, windowShortcutLabel(row.key)]),
  );
}

/**
 * Opens or closes the project filter menu when something asks (the dot, the
 * palette, a shortcut, saving a view).
 */
export function useWindowViewMenuRequests(setOpen: (open: boolean) => void): void {
  const request = useWindowViewStore((state) => state.menuRequest);
  // Stable, so only a new request moves the menu, not a re-render with a new callback.
  const applyRequest = useStableCallback(setOpen);
  useEffect(() => {
    if (request.count > 0) applyRequest(request.open);
  }, [applyRequest, request]);
}

/**
 * The view's color and name beside the wordmark. The name gives way first when
 * the sidebar narrows; the dot stays, gray while the window shows everything.
 */
export function WindowViewIndicator() {
  const view = useWindowViewStore((state) => state.view);
  const savedName = useWindowViewStore((state) => state.savedName);
  const savedViews = useWindowViewStore((state) => state.savedViews);
  const saved = savedViews.find((entry) => entry.name === savedName) ?? null;
  const color = windowViewColor(view, saved);
  const label = describeWindowView(view, savedName);
  return (
    <>
      <SaveWindowViewDialog />
      <button
        type="button"
        onClick={requestWindowViewMenu}
        aria-label={`Window view: ${label}`}
        // The name wraps onto a clipped second line rather than truncating, so a
        // narrow sidebar shows the dot alone.
        className="flex h-7 min-w-2.5 grow basis-0 flex-wrap content-start gap-x-1.5 overflow-hidden rounded-md text-left text-sm outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span className="flex h-7 shrink-0 items-center">
          <span
            className="size-2.5 rounded-full bg-muted-foreground/40"
            style={color === null ? undefined : { backgroundColor: color }}
          />
        </span>
        <span
          className={
            view === null
              ? "whitespace-nowrap leading-7 text-muted-foreground"
              : "whitespace-nowrap font-medium leading-7 text-foreground"
          }
        >
          {label}
        </span>
      </button>
    </>
  );
}

/** Saved views and the only/except toggle, above the filter menu's project list. */
export function WindowViewMenuHeader() {
  const view = useWindowViewStore((state) => state.view);
  const savedName = useWindowViewStore((state) => state.savedName);
  const savedViews = useWindowViewStore((state) => state.savedViews);
  const pendingMode = useWindowViewStore((state) => state.pendingMode);
  const shortcuts = useWindowShortcutLabels();
  const mode = view?.mode ?? pendingMode;
  return (
    <div className="flex flex-col gap-2 px-1 pt-1">
      {savedViews.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {savedViews.map((entry) => {
            const shortcut = shortcuts.get(`view:${entry.name}`) ?? null;
            return (
              <div key={entry.name} className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={entry.name === savedName ? "secondary" : "ghost"}
                  className="min-w-0 flex-1"
                  onClick={() => setWindowView(entry, entry.name)}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: WINDOW_VIEW_COLORS[entry.color] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                  {shortcut !== null ? <Kbd>{shortcut}</Kbd> : null}
                </Button>
                {canOpenWindows() ? (
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    title={`Open ${entry.name} in a new window`}
                    onClick={() => openWindowWithView(windowViewSpec(entry, entry.name))}
                  >
                    <AppWindowIcon />
                  </Button>
                ) : null}
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  title={`Delete ${entry.name}`}
                  onClick={() => deleteSavedWindowView(entry.name)}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <ToggleGroup
        value={[mode]}
        onValueChange={(next) => {
          const nextMode = next[0];
          if (nextMode !== "only" && nextMode !== "except") return;
          useWindowViewStore.setState({ pendingMode: nextMode });
          if (view !== null) setWindowView({ ...view, mode: nextMode });
        }}
        aria-label="Show"
      >
        <Toggle value="only">Only these</Toggle>
        <Toggle value="except">All except these</Toggle>
      </ToggleGroup>
    </div>
  );
}

// The row behind the checkbox selects that project alone; a tick must not reach it.
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Ticks a project into the window view, leaving the row's own single pick alone. */
export function WindowViewProjectCheckbox({ name }: { name: string }) {
  const view = useWindowViewStore((state) => state.view);
  const pendingMode = useWindowViewStore((state) => state.pendingMode);
  const mode = view?.mode ?? pendingMode;
  const checked =
    view?.mode === mode &&
    view.projects.some((picked) => picked.toLowerCase() === name.toLowerCase());
  return (
    <span
      className="flex shrink-0"
      onPointerDown={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
    >
      <Checkbox
        checked={checked}
        aria-label={`${mode === "only" ? "Show" : "Hide"} ${name} in this window`}
        onCheckedChange={() => setWindowView(toggleWindowViewProject(view, mode, name))}
      />
    </span>
  );
}

export function WindowViewThreadCount({ projectKey }: { projectKey: string }) {
  const count = useWindowViewStore((state) => state.threadCounts.get(projectKey) ?? 0);
  return (
    <span className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
      {count === 1 ? "1 thread" : `${count} threads`}
    </span>
  );
}

/** Save the view, show everything again, or open a window with this view. */
export function WindowViewMenuFooter() {
  const view = useWindowViewStore((state) => state.view);
  const savedName = useWindowViewStore((state) => state.savedName);
  const shortcuts = useWindowShortcutLabels();
  const newWindowShortcut = shortcuts.get("new-window") ?? null;
  if (view === null && !canOpenWindows()) return null;
  return (
    <div className="flex flex-col gap-0.5 border-t p-1">
      {view !== null && savedName === null ? (
        // The menu keeps focus on its search field, so naming happens in a dialog.
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            useWindowViewStore.setState({ saveDialogOpen: true });
            closeWindowViewMenu();
          }}
        >
          <span className="min-w-0 flex-1 truncate text-left">Save as view…</span>
        </Button>
      ) : null}
      {view !== null ? (
        <Button size="sm" variant="ghost" onClick={() => setWindowView(null)}>
          <span className="min-w-0 flex-1 truncate text-left">Show all projects</span>
        </Button>
      ) : null}
      {canOpenWindows() ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openWindowWithView(currentWindowViewSpec())}
        >
          <span className="min-w-0 flex-1 truncate text-left">Open in new window</span>
          {newWindowShortcut !== null ? <Kbd>{newWindowShortcut}</Kbd> : null}
        </Button>
      ) : null}
    </div>
  );
}

/** Names and colors the current view. Mounted with the indicator, which outlives the menu. */
function SaveWindowViewDialog() {
  const open = useWindowViewStore((state) => state.saveDialogOpen);
  const view = useWindowViewStore((state) => state.view);
  const [name, setName] = useState("");
  const [color, setColor] = useState<WindowViewColor>("blue");
  const close = () => useWindowViewStore.setState({ saveDialogOpen: false });
  return (
    <Dialog
      open={open && view !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === "") return;
            saveWindowView(name, color);
            setName("");
            close();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              {view === null ? "" : describeWindowView(view, null)}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-3">
              <Input
                autoFocus
                placeholder="View name"
                aria-label="View name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="flex gap-2" role="radiogroup" aria-label="View color">
                {Object.entries(WINDOW_VIEW_COLORS).map(([key, hex]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={color === key}
                    aria-label={key}
                    className="size-5 rounded-full aria-checked:ring-2 aria-checked:ring-foreground aria-checked:ring-inset"
                    style={{ backgroundColor: hex }}
                    onClick={() => {
                      if (isWindowViewColor(key)) setColor(key);
                    }}
                  />
                ))}
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={name.trim() === ""}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
