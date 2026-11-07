// T3 Space fork: tune how file trees look and open, behind a Labs flag.
import { createFileTreeIconResolver, type FileTreeIcons } from "@pierre/trees";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useState, useSyncExternalStore } from "react";

import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  useLocalStorage,
} from "../hooks/useLocalStorage";
import { T3_PIERRE_ICONS } from "../pierre-icons";
import { folderVariables, startMaterialFolders } from "./folderIcons";
import {
  loadMaterialIcons,
  materialFileTreeIcons,
  materialIconTable,
  subscribeMaterialIcons,
} from "./materialIcons";

export const FILE_TREE_ICON_PACKS = ["t3", "material", "complete", "standard", "minimal"] as const;
export type FileTreeIconPack = (typeof FILE_TREE_ICON_PACKS)[number];
export const FILE_TREE_FONTS = ["default", "interface", "code"] as const;
export type FileTreeFont = (typeof FILE_TREE_FONTS)[number];
export const DIFF_TREE_ON_OPEN = ["remember", "open", "closed"] as const;
export type DiffTreeOnOpen = (typeof DIFF_TREE_ON_OPEN)[number];
export const FILE_TREE_FOLDERS = ["default", "icons", "both"] as const;

export const FileTreeLook = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  font: Schema.Literals(FILE_TREE_FONTS).pipe(
    Schema.withDecodingDefault(Effect.succeed("default" as const)),
  ),
  // 0 keeps each tree's own size or indent.
  fontSize: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  indent: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  icons: Schema.Literals(FILE_TREE_ICON_PACKS).pipe(
    Schema.withDecodingDefault(Effect.succeed("t3" as const)),
  ),
  colored: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  folders: Schema.Literals(FILE_TREE_FOLDERS).pipe(
    Schema.withDecodingDefault(Effect.succeed("default" as const)),
  ),
  inlineExpanded: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  diffAllFilesToggle: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  diffTreeOnOpen: Schema.Literals(DIFF_TREE_ON_OPEN).pipe(
    Schema.withDecodingDefault(Effect.succeed("remember" as const)),
  ),
});
export type FileTreeLook = typeof FileTreeLook.Type;

// localStorage, like code themes: per device, and read before the first tree renders.
const STORAGE_KEY = "t3code:file-tree-look:v1";
export const DEFAULT_FILE_TREE_LOOK: FileTreeLook = Schema.decodeSync(FileTreeLook)({});

/** The raw saved settings, for the settings page. */
export function useFileTreeLookSettings() {
  return useLocalStorage(STORAGE_KEY, DEFAULT_FILE_TREE_LOOK, FileTreeLook);
}

/** What trees apply: T3's defaults while the Labs flag is off. */
export function effectiveFileTreeLook(saved: FileTreeLook): FileTreeLook {
  return saved.enabled ? saved : DEFAULT_FILE_TREE_LOOK;
}

export function useFileTreeLook(): FileTreeLook {
  return effectiveFileTreeLook(useFileTreeLookSettings()[0]);
}

/** Icons for Pierre trees, updating once Material's table has loaded. */
export function useFileTreeIcons(): Exclude<FileTreeIcons, string> {
  const look = useFileTreeLook();
  useSyncExternalStore(subscribeMaterialIcons, materialIconTable);
  return fileTreeIconsFor(look);
}

const iconsCache = new Map<string, FileTreeIcons>();
/** Icons for Pierre trees, one stable object per choice so models only reset on a change. */
export function fileTreeIconsFor(look: FileTreeLook): Exclude<FileTreeIcons, string> {
  if (look.icons === "material") {
    const table = materialIconTable();
    if (table) return materialFileTreeIcons(table);
    void loadMaterialIcons();
  }
  const key = `${look.icons}:${look.colored}`;
  let icons = iconsCache.get(key);
  if (!icons) {
    icons =
      look.icons === "t3" || look.icons === "material"
        ? { ...T3_PIERRE_ICONS, colored: look.colored }
        : { set: look.icons, colored: look.colored };
    iconsCache.set(key, icons);
  }
  return icons as Exclude<FileTreeIcons, string>;
}

const resolverCache = new Map<FileTreeIconPack, ReturnType<typeof createFileTreeIconResolver>>();
/** A resolver for React-rendered rows; null means T3's own. */
export function iconResolverFor(look: FileTreeLook) {
  if (look.icons === "t3" || look.icons === "material") return null;
  let resolver = resolverCache.get(look.icons);
  if (!resolver) {
    resolver = createFileTreeIconResolver({ set: look.icons, colored: true });
    resolverCache.set(look.icons, resolver);
  }
  return resolver;
}

/** CSS variables every tree reads; an absent one leaves that tree's own value. */
export function fileTreeLookVariables(look: FileTreeLook): Record<string, string | null> {
  return {
    "--file-tree-font-family":
      look.font === "interface"
        ? "var(--font-sans)"
        : look.font === "code"
          ? "var(--font-mono)"
          : null,
    "--file-tree-font-size": look.fontSize > 0 ? `${look.fontSize}px` : null,
    "--file-tree-indent": look.indent > 0 ? `${look.indent}px` : null,
    ...folderVariables(look.folders, look.icons === "material"),
  };
}

export function startFileTreeLook(): void {
  const root = document.documentElement;
  let stopFolders: (() => void) | null = null;
  const apply = () => {
    const look = effectiveFileTreeLook(
      readLocalStorageValue(STORAGE_KEY, DEFAULT_FILE_TREE_LOOK, FileTreeLook),
    );
    for (const [name, value] of Object.entries(fileTreeLookVariables(look))) {
      if (value === null) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
    stopFolders?.();
    stopFolders = null;
    if (look.icons === "material") {
      if (materialIconTable() === null) return void loadMaterialIcons();
      if (look.folders !== "default") stopFolders = startMaterialFolders();
    }
  };
  subscribeLocalStorageKey(STORAGE_KEY, apply);
  subscribeMaterialIcons(apply);
  apply();
}

/** Whether a diff's file tree starts open: remembered per surface, or fixed by the setting. */
export function useDiffFileTreeOpen(storageKey: string) {
  const { diffTreeOnOpen } = useFileTreeLook();
  const [remembered, setRemembered] = useLocalStorage(storageKey, false, Schema.Boolean);
  const [fixed, setFixed] = useState(diffTreeOnOpen === "open");
  return diffTreeOnOpen === "remember"
    ? ([remembered, (open: boolean) => setRemembered(open)] as const)
    : ([fixed, setFixed] as const);
}
