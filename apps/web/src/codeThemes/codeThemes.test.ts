import { describe, expect, it } from "vite-plus/test";

import { CODE_THEMES, codeThemeFor, type CodeThemeSettings } from "./codeThemes";

const settings = (patch: Partial<CodeThemeSettings>): CodeThemeSettings => ({
  enabled: true,
  engine: "highlights",
  dark: "",
  light: "",
  ...patch,
});

describe("codeThemeFor", () => {
  it.each([
    ["flag off ignores picks", settings({ enabled: false, dark: "nord" }), "dark", undefined],
    ["default on Pierre keeps T3's theme", settings({}), "light", undefined],
    [
      "default light on Shiki uses pierre-light",
      settings({ engine: "shiki" }),
      "light",
      "pierre-light",
    ],
    ["bundled pick on Pierre", settings({ dark: "nord" }), "dark", "nord"],
    ["Shiki-only pick on Pierre falls back", settings({ dark: "cobalt2" }), "dark", undefined],
    ["Shiki-only pick on Shiki", settings({ engine: "shiki", dark: "cobalt2" }), "dark", "cobalt2"],
    ["unknown id falls back", settings({ dark: "not-a-theme" }), "dark", undefined],
    ["a dark theme is not used for light", settings({ light: "nord" }), "light", undefined],
  ] as const)("%s", (_, input, appearance, expected) => {
    expect(codeThemeFor(input, appearance)).toBe(expected);
  });

  it("ships a VS Code file for every Shiki-only theme", () => {
    const files = Object.keys(import.meta.glob("./vscode/*.json")).map((path) =>
      path.slice("./vscode/".length, -".json".length),
    );
    const shikiOnly = [...CODE_THEMES.dark, ...CODE_THEMES.light]
      .filter((theme) => theme.shikiOnly)
      .map((theme) => theme.id);
    expect(shikiOnly.toSorted()).toEqual(files.toSorted());
  });
});
