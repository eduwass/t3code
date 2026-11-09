// T3 Space fork: the Labs switch and the Appearance section for code themes.
import { preloadPatchFile } from "@pierre/diffs/ssr";
import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";

import { useRenderedAppearance } from "../hooks/useTheme";
import { DIFF_THEME_NAMES } from "../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../lib/syntaxHighlighting";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import {
  CODE_THEMES,
  codeThemeFor,
  effectiveEngine,
  needsReload,
  STARTUP_CODE_THEME_SETTINGS,
  useCodeThemeSettings,
  type CodeThemeAppearance,
  type SyntaxEngine,
} from "./codeThemes";

const ENGINE_LABELS: Record<SyntaxEngine, string> = {
  highlights: "Pierre (fast)",
  shiki: "Shiki (matches VS Code)",
};
const DEFAULT_THEME_VALUE = "default";

export function CodeThemesLabsRow() {
  const [settings, setSettings] = useCodeThemeSettings();
  return (
    <SettingsRow
      {...searchableSetting("code-themes")}
      description="Pick code themes for light and dark mode, and choose Pierre's fast highlighter or Shiki, which colors code exactly like VS Code. The settings appear under Appearance. This device only."
      control={
        <Switch
          checked={settings.enabled}
          onCheckedChange={(checked) => setSettings({ ...settings, enabled: Boolean(checked) })}
          aria-label="Code themes"
        />
      }
    />
  );
}

export function CodeThemeSection() {
  const [settings, setSettings] = useCodeThemeSettings();
  if (!settings.enabled && !needsReload(settings)) return null;
  const engine = effectiveEngine(settings);
  return (
    <SettingsSection id="appearance-code" title="Code">
      {settings.enabled ? (
        <>
          <SettingsRow
            title="Highlighting engine"
            description="Pierre is many times faster on large files. Shiki uses VS Code's grammars, so themes look exactly as they do in VS Code or Cursor."
            control={
              <Select
                value={settings.engine}
                onValueChange={(value) => {
                  if (value === "highlights" || value === "shiki") {
                    setSettings({ ...settings, engine: value });
                  }
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0 sm:w-56" aria-label="Engine">
                  <SelectValue>{ENGINE_LABELS[settings.engine]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="highlights">{ENGINE_LABELS.highlights}</SelectItem>
                  <SelectItem value="shiki">{ENGINE_LABELS.shiki}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
          <CodeThemeRow appearance="dark" engine={engine} />
          <CodeThemeRow appearance="light" engine={engine} />
        </>
      ) : null}
      {needsReload(settings) ? (
        <SettingsRow
          title="Reload to apply"
          description="Open code keeps its current engine and theme until the app reloads."
          control={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      ) : null}
      {settings.enabled ? <CodeThemePreview /> : null}
    </SettingsSection>
  );
}

function CodeThemeRow({
  appearance,
  engine,
}: {
  appearance: CodeThemeAppearance;
  engine: SyntaxEngine;
}) {
  const [settings, setSettings] = useCodeThemeSettings();
  const themes = CODE_THEMES[appearance];
  const selected = themes.find((theme) => theme.id === settings[appearance]);
  const selectedLabel = selected?.label ?? "T3 default";
  const unavailable = selected?.shikiOnly && engine !== "shiki";
  return (
    <SettingsRow
      title={appearance === "dark" ? "Dark code theme" : "Light code theme"}
      description={
        unavailable
          ? `${selectedLabel} needs the Shiki engine, so T3's default shows instead.`
          : `Used while the interface is ${appearance}.`
      }
      control={
        <Select
          value={settings[appearance] || DEFAULT_THEME_VALUE}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            setSettings({ ...settings, [appearance]: value === DEFAULT_THEME_VALUE ? "" : value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full min-w-0 sm:w-56"
            aria-label={`${appearance} code theme`}
          >
            <SelectValue>{selectedLabel}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false} className="max-h-96">
            <SelectItem value={DEFAULT_THEME_VALUE}>T3 default</SelectItem>
            {themes.map((theme) => (
              <SelectItem
                key={theme.id}
                value={theme.id}
                disabled={theme.shikiOnly && engine !== "shiki"}
              >
                {theme.label}
                {theme.shikiOnly && engine !== "shiki" ? (
                  <span className="ms-2 text-muted-foreground">Shiki only</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const PREVIEW_PATCHES = {
  TypeScript: [
    "diff --git a/src/api.ts b/src/api.ts",
    "--- a/src/api.ts",
    "+++ b/src/api.ts",
    "@@ -1,10 +1,10 @@",
    " const config = {",
    '   apiUrl: "https://api.example.com",',
    "   timeout: 5000,",
    "-  debug: true,",
    '+  headers: { "Content-Type": "application/json" },',
    " };",
    "-async function fetchUser(id: string): Promise<User> {",
    "-  const url = `${config.apiUrl}/users/${id}`;",
    "+async function fetchUser(id: string): Promise<User | null> {",
    "+  const url = `${config.apiUrl}/v2/users/${id}`;",
    "   const response = await fetch(url);",
    "   return response.json();",
    " }",
    "",
  ],
  Python: [
    "diff --git a/app/users.py b/app/users.py",
    "--- a/app/users.py",
    "+++ b/app/users.py",
    "@@ -1,9 +1,10 @@",
    " from dataclasses import dataclass",
    " ",
    " @dataclass",
    " class User:",
    "     name: str",
    "-    age: int = 0",
    "+    email: str | None = None",
    "+    age: int = 0  # years",
    " ",
    " def greet(user: User) -> str:",
    '     return f"Hello, {user.name}!"',
    "",
  ],
  Rust: [
    "diff --git a/src/main.rs b/src/main.rs",
    "--- a/src/main.rs",
    "+++ b/src/main.rs",
    "@@ -1,6 +1,7 @@",
    " #[derive(Debug)]",
    " struct User {",
    "     name: String,",
    "-    age: u32,",
    "+    age: Option<u32>,",
    "+    active: bool,",
    " }",
    ' fn main() { println!("{:?}", User { name: "Ada".into(), age: Some(36), active: true }); }',
    "",
  ],
  Go: [
    "diff --git a/main.go b/main.go",
    "--- a/main.go",
    "+++ b/main.go",
    "@@ -1,7 +1,8 @@",
    " package main",
    " ",
    ' import "fmt"',
    " ",
    " func main() {",
    '-	fmt.Println("hello")',
    '+	name := "world"',
    '+	fmt.Printf("hello, %s\\n", name)',
    " }",
    "",
  ],
} as const;
type PreviewLanguage = keyof typeof PREVIEW_PATCHES;
const PREVIEW_LANGUAGES = Object.keys(PREVIEW_PATCHES) as PreviewLanguage[];

// Same surface tokens as the font preview, so the preview matches the diff panel.
const PREVIEW_THEME_BRIDGE = `
  :host {
    --diffs-bg: var(--code-background);
    --diffs-light-bg: var(--code-background);
    --diffs-dark-bg: var(--code-background);
  }
  [data-diffs-header] { display: none; }
`;

const previewHtmlAtom = Atom.family((key: string) => {
  const [theme, language] = key.split("|") as [string, PreviewLanguage];
  return Atom.make(
    Effect.promise(() =>
      preloadPatchFile({
        patch: PREVIEW_PATCHES[language].join("\n"),
        options: { diffStyle: "unified", theme, preferredHighlighter: PREFERRED_HIGHLIGHTER },
      }).then((results) => results.map((result) => result.prerenderedHTML)),
    ),
  ).pipe(Atom.keepAlive, Atom.withLabel(`code-theme-preview:${key}`));
});

function StaticHtml({ html }: { html: string }) {
  const attach = (host: HTMLDivElement | null) => {
    if (host === null) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.innerHTML = html;
    const bridge = document.createElement("style");
    bridge.textContent = PREVIEW_THEME_BRIDGE;
    shadow.append(bridge);
  };
  return <div ref={attach} />;
}

function CodeThemePreview() {
  const [settings] = useCodeThemeSettings();
  const appearance = useRenderedAppearance();
  const [language, setLanguage] = useState<PreviewLanguage>("TypeScript");
  // The page can only highlight with the engine it started with.
  const runningEngine = effectiveEngine(STARTUP_CODE_THEME_SETTINGS);
  const previewSettings = { ...settings, engine: runningEngine };
  const theme = codeThemeFor(previewSettings, appearance) ?? DIFF_THEME_NAMES[appearance];
  const engineMismatch = effectiveEngine(settings) !== runningEngine;
  const picked = CODE_THEMES[appearance].find((entry) => entry.id === settings[appearance]);
  const blocked = picked?.shikiOnly && runningEngine !== "shiki";
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="relative overflow-hidden rounded-lg border border-border">
        <div className="absolute end-2 top-2 z-10">
          <Select
            value={language}
            onValueChange={(value) => {
              if (typeof value === "string" && value in PREVIEW_PATCHES) {
                setLanguage(value as PreviewLanguage);
              }
            }}
          >
            <SelectTrigger size="sm" className="w-32" aria-label="Preview language">
              <SelectValue>{language}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {PREVIEW_LANGUAGES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <PreviewDiff theme={theme} language={language} />
      </div>
      {blocked || engineMismatch ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {blocked
            ? `${picked.label} needs the Shiki engine. Reload with Shiki to preview it.`
            : `Previewing with ${ENGINE_LABELS[runningEngine]} until you reload.`}
        </p>
      ) : null}
    </div>
  );
}

function PreviewDiff({ theme, language }: { theme: string; language: PreviewLanguage }) {
  const loaded = AsyncResult.getOrElse(
    useAtomValue(previewHtmlAtom(`${theme}|${language}`)),
    () => null,
  );
  // Keep the last preview up while the next theme renders, so the box never collapses.
  const [shown, setShown] = useState(loaded);
  if (loaded !== null && loaded !== shown) setShown(loaded);
  if (shown === null) return <div className="h-64" />;
  return (
    <div className="max-h-80 overflow-auto">
      {shown.map((html) => (
        <StaticHtml key={html} html={html} />
      ))}
    </div>
  );
}
