// Windows opened with File > New Window, beside the main one: where they open,
// and which renderers count as the app's own for IPC that trusts only those.
import type * as Electron from "electron";

// Keyed by webContents id, read before the window is destroyed.
const additionalWindows = new Map<number, Electron.BrowserWindow>();

export function trackAdditionalWindow(window: Electron.BrowserWindow): void {
  const id = window.webContents.id;
  additionalWindows.set(id, window);
  window.once("closed", () => additionalWindows.delete(id));
}

/** Called when the window becomes the main window, which IPC already trusts. */
export function forgetAdditionalWindow(window: Electron.BrowserWindow): void {
  for (const [id, candidate] of additionalWindows) {
    if (candidate === window) additionalWindows.delete(id);
  }
}

export const isAdditionalWindow = (window: Electron.BrowserWindow): boolean =>
  [...additionalWindows.values()].includes(window);

export const firstAdditionalWindow = (): Electron.BrowserWindow | undefined =>
  [...additionalWindows.values()].find((window) => !window.isDestroyed());

/** The additional window whose own renderer sent an IPC request, if it is one. */
export function additionalWindowForSender(senderId: number): Electron.BrowserWindow | undefined {
  const window = additionalWindows.get(senderId);
  return window !== undefined && !window.isDestroyed() ? window : undefined;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const CASCADE_OFFSET = 28;

const contains = (display: Rect, x: number, y: number) =>
  x >= display.x &&
  y >= display.y &&
  x < display.x + display.width &&
  y < display.y + display.height;

/**
 * A new window opens at the focused window's size, shifted down and right so both
 * title bars stay visible. Once that would run off the focused window's display it
 * starts again at the display's top-left. With no window to follow, it returns null
 * and the caller uses its default size, centred.
 */
export function cascadeWindowBounds(from: Rect | null, displays: readonly Rect[]): Rect | null {
  if (from === null) return null;
  const next = { ...from, x: from.x + CASCADE_OFFSET, y: from.y + CASCADE_OFFSET };
  const display = displays.find((candidate) => contains(candidate, from.x, from.y));
  if (display === undefined) return next;
  const fits =
    next.x + next.width <= display.x + display.width &&
    next.y + next.height <= display.y + display.height;
  return fits ? next : { ...next, x: display.x + CASCADE_OFFSET, y: display.y + CASCADE_OFFSET };
}
