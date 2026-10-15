import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { takeInitialWindowView as takeView } from "../../window/AdditionalWindows.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

// The renderer opens windows itself so "New window" can carry the focused
// window's view; the view is opaque here and read back by the new renderer.
export const openNewWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_NEW_WINDOW_CHANNEL,
  payload: Schema.UndefinedOr(Schema.String),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.openNewWindow")(function* (view) {
    yield* (yield* DesktopWindow.DesktopWindow).createAdditional(view);
  }),
});

// Right-clicking T3 Space in the Dock opens a saved view, or a plain window,
// without bringing an existing window forward first.
export const setDockWindowViews = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_DOCK_WINDOW_VIEWS_CHANNEL,
  payload: Schema.Array(Schema.Struct({ name: Schema.String, view: Schema.String })),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setDockWindowViews")(function* (views) {
    const dock = Electron.app.dock;
    if (dock === undefined) return;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    const open = (view?: string) => () => void runFork(desktopWindow.createAdditional(view));
    dock.setMenu(
      Electron.Menu.buildFromTemplate([
        { label: "New Window", click: open() },
        ...(views.length > 0 ? [{ type: "separator" as const }] : []),
        ...views.map((entry) => ({ label: entry.name, click: open(entry.view) })),
      ]),
    );
  }),
});

export const takeInitialWindowView = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TAKE_INITIAL_WINDOW_VIEW_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.takeInitialWindowView")(function* (_input, event) {
    return event === undefined ? null : takeView(event.sender.id);
  }),
});
