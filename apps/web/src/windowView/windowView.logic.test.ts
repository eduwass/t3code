import { describe, expect, it } from "vite-plus/test";

import {
  parseWindowViewSpec,
  toggleWindowViewProject,
  windowViewGroups,
  windowViewProjectKeys,
  windowViewSpec,
  type SavedWindowView,
} from "./windowView.logic";

const group = (displayName: string, projectId: string) => ({
  displayName,
  memberProjectRefs: [{ environmentId: "devbox", projectId }],
});
const groups = [group("goldflower", "g"), group("eventintel", "e"), group("personal", "p")];
const work: SavedWindowView = {
  name: "Work",
  color: "blue",
  mode: "only",
  projects: ["eventintel", "goldflower"],
};

describe("window views", () => {
  it("shows only the named projects, or all but them", () => {
    const only = parseWindowViewSpec("only=Goldflower", []).view;
    expect([...(windowViewProjectKeys(only, groups) ?? [])]).toEqual(["devbox:g"]);

    const except = parseWindowViewSpec("except=goldflower,eventintel", []).view;
    expect([...(windowViewProjectKeys(except, groups) ?? [])]).toEqual(["devbox:p"]);

    expect(windowViewProjectKeys(parseWindowViewSpec("", []).view, groups)).toBeNull();
  });

  it("offers only the view's projects for new threads", () => {
    const except = parseWindowViewSpec("except=goldflower", []).view;
    expect(windowViewGroups(except, groups).map((g) => g.displayName)).toEqual([
      "eventintel",
      "personal",
    ]);
    expect(windowViewGroups(null, groups)).toBe(groups);
  });

  it("round-trips links, and resolves saved views by name", () => {
    const view = toggleWindowViewProject(
      toggleWindowViewProject(null, "except", "my project"),
      "except",
      "eventintel",
    );
    expect(parseWindowViewSpec(windowViewSpec(view, null), []).view).toEqual(view);

    expect(parseWindowViewSpec("view=work", [work])).toEqual({
      view: { mode: "only", projects: ["eventintel", "goldflower"] },
      savedName: "Work",
    });
    expect(parseWindowViewSpec("view=missing", [work]).view).toBeNull();
  });
});

describe("window keybindings", () => {
  it("numbers saved views by default and honours overrides", async () => {
    const { resolveWindowKeybinding, windowKeybindingRows } = await import("./windowKeybindings");
    const personal: SavedWindowView = { ...work, name: "Personal", mode: "except" };
    const rows = windowKeybindingRows([work, personal], { "view:Personal": "mod+ctrl+p" });
    const press = (key: string, code: string) => ({
      key,
      code,
      metaKey: true,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    });
    expect(resolveWindowKeybinding(press("1", "Digit1"), rows, "MacIntel")).toBe("view:Work");
    expect(resolveWindowKeybinding(press("2", "Digit2"), rows, "MacIntel")).toBeNull();
    expect(resolveWindowKeybinding(press("p", "KeyP"), rows, "MacIntel")).toBe("view:Personal");
    expect(resolveWindowKeybinding(press("n", "KeyN"), rows, "MacIntel")).toBe("new-window");
  });
});
