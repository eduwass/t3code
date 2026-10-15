import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { keybindingFromKeyboardEvent } from "../components/settings/KeybindingsSettings.logic";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Kbd } from "../components/ui/kbd";
import { windowShortcutLabel } from "./WindowViewMenu";
import {
  setWindowKeybinding,
  useWindowKeybindingsStore,
  windowKeybindingRows,
  type WindowKeybindingRow,
} from "./windowKeybindings";
import { canOpenWindows, useWindowViewStore } from "./windowViewStore";

/**
 * Settings > Keybindings > Windows. These shortcuts are kept on this machine by
 * T3 Space, so they sit outside the server's keybinding list and its permissions.
 */
export function WindowKeybindingsSection({ query }: { query: string }) {
  const savedViews = useWindowViewStore((state) => state.savedViews);
  const overrides = useWindowKeybindingsStore((state) => state.overrides);
  if (!canOpenWindows()) return null;
  const needle = query.trim().toLowerCase();
  const rows = windowKeybindingRows(savedViews, overrides).filter(
    (row) =>
      needle === "" ||
      row.label.toLowerCase().includes(needle) ||
      row.description.toLowerCase().includes(needle) ||
      "window".includes(needle),
  );
  if (rows.length === 0) return null;
  return (
    <SettingsSection id="keybindings-windows" title="Windows · stored on this Mac">
      {rows.map((row) => (
        <WindowKeybindingSettingsRow key={row.id} row={row} overridden={row.id in overrides} />
      ))}
    </SettingsSection>
  );
}

function WindowKeybindingSettingsRow({
  row,
  overridden,
}: {
  row: WindowKeybindingRow;
  overridden: boolean;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const label = windowShortcutLabel(row.key);
  return (
    <SettingsRow
      className="rounded-none"
      title={row.label}
      description={row.description}
      control={
        <div className="flex items-center justify-end gap-1.5">
          {overridden ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Reset ${row.label} to its default shortcut`}
              onClick={() => setWindowKeybinding(row.id, null)}
            >
              <RotateCcwIcon />
            </Button>
          ) : null}
          {isRecording ? (
            <Input
              autoFocus
              size="sm"
              font="mono"
              className="w-44"
              aria-label={`Shortcut for ${row.label}`}
              placeholder="Press shortcut"
              value=""
              onChange={() => undefined}
              onBlur={() => setIsRecording(false)}
              onKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                  setIsRecording(false);
                  return;
                }
                if (event.key === "Backspace" || event.key === "Delete") {
                  setWindowKeybinding(row.id, "");
                  setIsRecording(false);
                  return;
                }
                const key = keybindingFromKeyboardEvent(event, navigator.platform);
                if (key === null) return;
                setWindowKeybinding(row.id, key);
                setIsRecording(false);
              }}
            />
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit shortcut for ${row.label}`}
              onClick={() => setIsRecording(true)}
            >
              {label !== null ? <Kbd>{label}</Kbd> : "Add"}
            </Button>
          )}
        </div>
      }
    />
  );
}
