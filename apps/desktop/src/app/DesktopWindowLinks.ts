// Window links open a window with a window view, for automation:
//   open "t3space://window?only=goldflower"
//   open "t3space://window?except=eventintel,goldflower"
//   open "t3space://window?view=Work"
// A new window lands on the current macOS Space, so a Space's own shortcut or
// script can switch to it and then open its view.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { setPendingMainWindowView } from "../window/AdditionalWindows.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

/** The view carried by a window link ("" for none), or null for any other URL. */
export function windowLinkView(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "t3space:" ||
    (parsed.host || parsed.pathname.replace(/^\/+/, "")) !== "window"
  ) {
    return null;
  }
  return parsed.search.replace(/^\?/, "");
}

export const registerWindowLinks = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const runPromise = Effect.runPromiseWith(
    yield* Effect.context<
      DesktopWindow.DesktopWindow | ElectronWindow.ElectronWindow | ElectronApp.ElectronApp
    >(),
  );
  const open = Effect.fn("DesktopWindowLinks.open")(
    function* (view: string) {
      yield* electronApp.whenReady;
      const existing = yield* (yield* ElectronWindow.ElectronWindow).currentMainOrFirst;
      const desktopWindow = yield* DesktopWindow.DesktopWindow;
      if (Option.isSome(existing)) {
        const window = yield* desktopWindow.createAdditional(view || undefined);
        window.focus();
        return;
      }
      // Startup (or a dock click) creates the first window; it takes the view.
      if (view) setPendingMainWindowView(view);
      yield* desktopWindow.activate;
    },
    Effect.catchCause((cause) => Effect.logWarning("Could not open a window link", cause)),
  );

  yield* electronApp.on("open-url", (event: { preventDefault: () => void }, url: string) => {
    const view = windowLinkView(url);
    if (view === null) return;
    event.preventDefault();
    void runPromise(open(view));
  });
});
