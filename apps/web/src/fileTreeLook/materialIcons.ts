// T3 Space fork: Material Icon Theme (MIT, by Philipp Kief) for file trees. The icons are
// served as static files, so a tree only fetches the ones on screen.
import type { FileTreeIconConfig } from "@pierre/trees";

export interface MaterialIconTable {
  readonly file: string;
  readonly folder: string;
  readonly folderOpen: string;
  readonly fileExtensions: Readonly<Record<string, string>>;
  readonly fileNames: Readonly<Record<string, string>>;
  readonly folderNames: Readonly<Record<string, string>>;
  readonly folderNamesOpen: Readonly<Record<string, string>>;
}

export const materialIconUrl = (name: string) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/material-icons/${name}.svg`;

let table: MaterialIconTable | null = null;
let loading: Promise<MaterialIconTable> | null = null;
const listeners = new Set<() => void>();

export function loadMaterialIcons(): Promise<MaterialIconTable> {
  if (loading === null) {
    loading = import("virtual:material-icons").then((module) => {
      table = module.default;
      for (const listener of listeners) listener();
      return module.default;
    });
  }
  return loading;
}

export const materialIconTable = () => table;
export function subscribeMaterialIcons(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const symbolId = (name: string) => `t3-material-${name}`;

let config: FileTreeIconConfig | null = null;
/** Pierre icon config: one sprite symbol per icon, each an <image> of the served SVG. */
export function materialFileTreeIcons(icons: MaterialIconTable): FileTreeIconConfig {
  if (config) return config;
  const names = new Set([
    icons.file,
    ...Object.values(icons.fileExtensions),
    ...Object.values(icons.fileNames),
  ]);
  const symbols = [...names]
    .map(
      (name) =>
        `<symbol id="${symbolId(name)}" viewBox="0 0 16 16"><image href="${materialIconUrl(name)}" width="16" height="16"/></symbol>`,
    )
    .join("");
  const remapAll = (record: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(record).map(([key, name]) => [key, symbolId(name)]));
  config = {
    set: "none",
    spriteSheet: `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols}</svg>`,
    remap: { "file-tree-icon-file": symbolId(icons.file) },
    byFileExtension: remapAll(icons.fileExtensions),
    byFileName: remapAll(icons.fileNames),
  };
  return config;
}

/** The Material icon for a folder, by name; the theme matches names case-insensitively. */
export function materialFolderIcon(icons: MaterialIconTable, name: string, open: boolean) {
  const key = name.toLowerCase();
  return open
    ? (icons.folderNamesOpen[key] ?? icons.folderOpen)
    : (icons.folderNames[key] ?? icons.folder);
}

/** Basename of a tree path, ignoring a trailing slash. */
export function folderNameOfPath(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The Material icon for a file: exact name first, then the longest matching extension. */
export function materialFileIcon(icons: MaterialIconTable, path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const lower = name.toLowerCase();
  const byName = icons.fileNames[name] ?? icons.fileNames[lower];
  if (byName) return byName;
  for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const icon = icons.fileExtensions[lower.slice(dot + 1)];
    if (icon) return icon;
  }
  return icons.file;
}
