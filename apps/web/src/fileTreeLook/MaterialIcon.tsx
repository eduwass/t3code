// T3 Space fork: Material icons for trees T3 draws itself, like changed files in chat.
import { type ReactNode, useSyncExternalStore } from "react";

import type { FileTreeLook } from "./fileTreeLook";
import {
  loadMaterialIcons,
  materialFileIcon,
  materialFolderIcon,
  materialIconTable,
  materialIconUrl,
  subscribeMaterialIcons,
} from "./materialIcons";

/** The Material icon for an entry while that pack is on; otherwise `children`. */
export function MaterialEntryIcon(props: {
  readonly look: FileTreeLook | undefined;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  const table = useSyncExternalStore(subscribeMaterialIcons, materialIconTable);
  if (props.look?.icons !== "material") return props.children;
  if (table === null) {
    void loadMaterialIcons();
    return props.children;
  }
  const name =
    props.kind === "directory"
      ? materialFolderIcon(table, props.path.slice(props.path.lastIndexOf("/") + 1), !!props.open)
      : materialFileIcon(table, props.path);
  return <img src={materialIconUrl(name)} alt="" aria-hidden className="size-4 shrink-0" />;
}
