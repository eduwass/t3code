// @effect-diagnostics nodeBuiltinImport:off - a Vite plugin runs before any Effect runtime.
// T3 Space fork: serves Material Icon Theme's SVGs at /material-icons/ and exposes a
// compact lookup table as `virtual:material-icons`, loaded only when the pack is chosen.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";

import type { Plugin } from "vite-plus";

const VIRTUAL_ID = "virtual:material-icons";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const URL_PREFIX = "/material-icons/";

// VS Code maps these languages to extensions itself; the theme only names the language.
const LANGUAGE_EXTENSIONS: Record<string, ReadonlyArray<string>> = {
  javascript: ["js", "mjs", "cjs"],
  javascriptreact: ["jsx"],
  typescript: ["ts", "mts", "cts"],
  typescriptreact: ["tsx"],
  json: ["json"],
  jsonc: ["jsonc"],
  markdown: ["md", "markdown"],
  html: ["html", "htm"],
  css: ["css"],
  scss: ["scss"],
  less: ["less"],
  python: ["py", "pyi"],
  ruby: ["rb"],
  go: ["go"],
  rust: ["rs"],
  java: ["java"],
  c: ["c", "h"],
  cpp: ["cpp", "cc", "cxx", "hpp", "hh"],
  csharp: ["cs"],
  php: ["php"],
  shellscript: ["sh", "bash", "zsh"],
  yaml: ["yml", "yaml"],
  xml: ["xml"],
  sql: ["sql"],
  swift: ["swift"],
  lua: ["lua"],
  dart: ["dart"],
  vue: ["vue"],
  svelte: ["svelte"],
  graphql: ["graphql", "gql"],
  toml: ["toml"],
  ini: ["ini"],
  bat: ["bat", "cmd"],
  powershell: ["ps1"],
  perl: ["pl", "pm"],
  r: ["r"],
  plaintext: ["txt"],
  dockerfile: ["dockerfile"],
  makefile: ["mk"],
  twig: ["twig"],
};

function iconsDirectory(): string {
  const require = NodeModule.createRequire(import.meta.url);
  return NodePath.join(
    NodePath.dirname(require.resolve("material-icon-theme/package.json")),
    "icons",
  );
}

interface Manifest {
  readonly file: string;
  readonly folder: string;
  readonly folderExpanded: string;
  readonly fileExtensions: Record<string, string>;
  readonly fileNames: Record<string, string>;
  readonly folderNames: Record<string, string>;
  readonly folderNamesExpanded: Record<string, string>;
  readonly languageIds: Record<string, string>;
}

function compactManifest(): string {
  const directory = iconsDirectory();
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(directory, "..", "dist", "material-icons.json"), "utf8"),
  ) as Manifest;
  const fileExtensions: Record<string, string> = {};
  for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
    const icon = manifest.languageIds[language];
    if (icon) for (const extension of extensions) fileExtensions[extension] = icon;
  }
  Object.assign(fileExtensions, manifest.fileExtensions);
  // Path-qualified names (".config/foo") need the full path; trees match basenames.
  const fileNames = Object.fromEntries(
    Object.entries(manifest.fileNames).filter(([name]) => !name.includes("/")),
  );
  return `export default ${JSON.stringify({
    file: manifest.file,
    folder: manifest.folder,
    folderOpen: manifest.folderExpanded,
    fileExtensions,
    fileNames,
    folderNames: manifest.folderNames,
    folderNamesOpen: manifest.folderNamesExpanded,
  })};`;
}

export function materialIconsPlugin(): Plugin {
  return {
    name: "t3-material-icons",
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load: (id) => (id === RESOLVED_ID ? compactManifest() : undefined),
    configureServer(server) {
      const directory = iconsDirectory();
      server.middlewares.use(URL_PREFIX, (request, response, next) => {
        const name = NodePath.basename(request.url?.split("?")[0] ?? "");
        const file = NodePath.join(directory, name);
        if (!name.endsWith(".svg") || !NodeFS.existsSync(file)) return next();
        response.setHeader("Content-Type", "image/svg+xml");
        response.setHeader("Cache-Control", "public, max-age=86400");
        response.end(NodeFS.readFileSync(file));
      });
    },
    generateBundle() {
      const directory = iconsDirectory();
      for (const name of NodeFS.readdirSync(directory)) {
        if (!name.endsWith(".svg")) continue;
        this.emitFile({
          type: "asset",
          fileName: `material-icons/${name}`,
          source: NodeFS.readFileSync(NodePath.join(directory, name)),
        });
      }
    },
  };
}
