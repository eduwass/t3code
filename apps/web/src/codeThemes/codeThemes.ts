// T3 Space fork: Linear-style code themes and a choice of highlighting engine, behind a Labs flag.
import { registerCustomTheme, type HighlighterTypes } from "@pierre/diffs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { readLocalStorageValue, useLocalStorage } from "../hooks/useLocalStorage";

export type CodeThemeAppearance = "light" | "dark";
export type SyntaxEngine = "highlights" | "shiki";

export interface CodeTheme {
  readonly id: string;
  readonly label: string;
  /** Only a VS Code file exists for it, which only the Shiki engine reads. */
  readonly shikiOnly?: true;
}

const vscode = (id: string, label: string): CodeTheme => ({ id, label, shikiOnly: true });

// Linear's catalog, under the names our engines ship, plus Pierre's own palettes.
export const CODE_THEMES: Record<CodeThemeAppearance, ReadonlyArray<CodeTheme>> = {
  dark: [
    { id: "pierre-dark-soft", label: "Pierre Dark Soft" },
    { id: "pierre-dark-vibrant", label: "Pierre Dark Vibrant" },
    { id: "pierre-dark-protanopia-deuteranopia", label: "Pierre Dark Colorblind" },
    { id: "pierre-dark-tritanopia", label: "Pierre Dark Tritanopia" },
    vscode("alabaster-dark", "Alabaster Dark"),
    { id: "andromeeda", label: "Andromeda" },
    vscode("atom-one-dark", "Atom One Dark"),
    { id: "ayu-dark", label: "Ayu Dark" },
    { id: "ayu-mirage", label: "Ayu Mirage" },
    { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
    { id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
    { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
    vscode("cobalt2", "Cobalt2"),
    vscode("darcula", "Darcula"),
    { id: "dracula", label: "Dracula" },
    vscode("edge-dark", "Edge Dark"),
    { id: "everforest-dark", label: "Everforest Dark" },
    { id: "github-dark", label: "GitHub Dark" },
    { id: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
    { id: "gruvbox-dark-medium", label: "Gruvbox Dark" },
    vscode("halcyon", "Halcyon"),
    { id: "houston", label: "Houston" },
    vscode("iceberg-dark", "Iceberg Dark"),
    { id: "dark-plus", label: "Modern Dark" },
    { id: "night-owl", label: "Night Owl" },
    { id: "nord", label: "Nord" },
    { id: "one-dark-pro", label: "One Dark Pro" },
    vscode("one-monokai", "One Monokai"),
    { id: "material-theme-palenight", label: "Palenight" },
    { id: "rose-pine", label: "Rosé Pine" },
    { id: "rose-pine-moon", label: "Rosé Pine Moon" },
    vscode("shades-of-purple", "Shades of Purple"),
    { id: "solarized-dark", label: "Solarized Dark" },
    vscode("sonokai", "Sonokai"),
    { id: "synthwave-84", label: "Synthwave '84" },
    { id: "tokyo-night", label: "Tokyo Night" },
    { id: "vitesse-dark", label: "Vitesse Dark" },
  ],
  light: [
    { id: "pierre-light", label: "Pierre Light" },
    { id: "pierre-light-soft", label: "Pierre Light Soft" },
    { id: "pierre-light-vibrant", label: "Pierre Light Vibrant" },
    { id: "pierre-light-protanopia-deuteranopia", label: "Pierre Light Colorblind" },
    { id: "pierre-light-tritanopia", label: "Pierre Light Tritanopia" },
    vscode("alabaster-light", "Alabaster Light"),
    vscode("atom-one-light", "Atom One Light"),
    { id: "ayu-light", label: "Ayu Light" },
    { id: "catppuccin-latte", label: "Catppuccin Latte" },
    vscode("edge-light", "Edge Light"),
    { id: "everforest-light", label: "Everforest Light" },
    { id: "github-light", label: "GitHub Light" },
    { id: "gruvbox-light-medium", label: "Gruvbox Light" },
    { id: "min-light", label: "Min Light" },
    { id: "light-plus", label: "Modern Light" },
    vscode("quiet-light", "Quiet Light"),
    { id: "rose-pine-dawn", label: "Rosé Pine Dawn" },
    { id: "solarized-light", label: "Solarized Light" },
    { id: "vitesse-light", label: "Vitesse Light" },
    vscode("winter-is-coming-light", "Winter is Coming Light"),
  ],
};

const VSCODE_THEME_FILES = import.meta.glob<{ default: object }>("./vscode/*.json");
for (const [path, load] of Object.entries(VSCODE_THEME_FILES)) {
  const id = path.slice("./vscode/".length, -".json".length);
  registerCustomTheme(id, load as Parameters<typeof registerCustomTheme>[1], "textmate");
}

export const CodeThemeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  engine: Schema.Literals(["highlights", "shiki"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("highlights" as const)),
  ),
  // Empty means T3's default for that appearance.
  dark: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  light: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type CodeThemeSettings = typeof CodeThemeSettings.Type;

// localStorage, like the interface theme: the engine must be known before anything highlights.
const STORAGE_KEY = "t3code:code-themes:v1";
const DEFAULT_SETTINGS: CodeThemeSettings = Schema.decodeSync(CodeThemeSettings)({});

export function useCodeThemeSettings() {
  return useLocalStorage(STORAGE_KEY, DEFAULT_SETTINGS, CodeThemeSettings);
}

/** What this page loaded with. The app applies these until a reload, so no view goes stale. */
export const STARTUP_CODE_THEME_SETTINGS: CodeThemeSettings =
  typeof window === "undefined"
    ? DEFAULT_SETTINGS
    : readLocalStorageValue(STORAGE_KEY, DEFAULT_SETTINGS, CodeThemeSettings);

export function effectiveEngine(settings: CodeThemeSettings): SyntaxEngine {
  return settings.enabled ? settings.engine : "highlights";
}

export function highlighterFor(engine: SyntaxEngine): HighlighterTypes {
  return engine === "shiki" ? "shiki-wasm" : "highlights";
}

/** The theme to render, or undefined for T3's default on the Highlights engine. */
export function codeThemeFor(
  settings: CodeThemeSettings,
  appearance: CodeThemeAppearance,
): string | undefined {
  const engine = effectiveEngine(settings);
  const picked = settings.enabled
    ? CODE_THEMES[appearance].find((theme) => theme.id === settings[appearance])
    : undefined;
  if (picked && !(picked.shikiOnly && engine !== "shiki")) return picked.id;
  // T3's darkened t3-light only exists as a Highlights palette.
  return engine === "shiki" && appearance === "light" ? "pierre-light" : undefined;
}

export function needsReload(saved: CodeThemeSettings): boolean {
  const startup = STARTUP_CODE_THEME_SETTINGS;
  return (
    effectiveEngine(saved) !== effectiveEngine(startup) ||
    codeThemeFor(saved, "light") !== codeThemeFor(startup, "light") ||
    codeThemeFor(saved, "dark") !== codeThemeFor(startup, "dark")
  );
}
