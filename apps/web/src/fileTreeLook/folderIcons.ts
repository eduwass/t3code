// T3 Space fork: folder icons and arrows in Pierre file trees. A fixed stylesheet reads
// CSS variables the settings set on the page; Material's named folders get rules added
// inside each tree for the folders it shows.
import { FILE_TREE_TAG_NAME } from "@pierre/trees";

import {
  folderNameOfPath,
  materialFolderIcon,
  materialIconTable,
  materialIconUrl,
  type MaterialIconTable,
} from "./materialIcons";

const ICON = `[data-item-type="folder"] > [data-item-section="icon"]`;

/** Joins every tree's own stylesheet; inert until a Folders choice sets the variables. */
export const FILE_TREE_FOLDER_CSS = `
@container style(--file-tree-folders: icons) {
  ${ICON} > svg { display: none; }
}
@container style(--file-tree-folders: both) {
  ${ICON} { width: auto; gap: 2px; }
  [data-item-type="file"] > [data-item-section="icon"] { padding-left: 18px; }
}
@container style(--file-tree-folders: icons) or style(--file-tree-folders: both) {
  ${ICON}::after {
    content: "";
    display: block;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    background: var(--file-tree-folder-image, none) center / contain no-repeat;
    background-color: var(--file-tree-folder-tint, transparent);
    mask: var(--file-tree-folder-mask, none) center / contain no-repeat;
  }
  [data-item-type="folder"][aria-expanded="true"] > [data-item-section="icon"]::after {
    background-image: var(--file-tree-folder-image-open, none);
    mask-image: var(--file-tree-folder-mask-open, none);
  }
}
`;

const svgUrl = (path: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`,
  )}")`;
// Lucide's folder and folder-open, used as masks so they take the text color.
const FOLDER_MASK = svgUrl(
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
);
const FOLDER_OPEN_MASK = svgUrl(
  '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
);

export type FileTreeFolders = "default" | "icons" | "both";

/** Variables for the page root; null removes one. */
export function folderVariables(
  folders: FileTreeFolders,
  material: boolean,
): Record<string, string | null> {
  const on = folders !== "default";
  return {
    "--file-tree-folders": on ? folders : null,
    "--file-tree-folder-image": on && material ? `url("${materialIconUrl("folder")}")` : null,
    "--file-tree-folder-image-open":
      on && material ? `url("${materialIconUrl("folder-open")}")` : null,
    "--file-tree-folder-mask": on && !material ? FOLDER_MASK : null,
    "--file-tree-folder-mask-open": on && !material ? FOLDER_OPEN_MASK : null,
    "--file-tree-folder-tint": on && !material ? "currentColor" : null,
  };
}

const STYLE_ATTRIBUTE = "data-t3-material-folders";
const quote = (value: string) => JSON.stringify(value);

function folderRule(icons: MaterialIconTable, name: string): string {
  const paths = [name, `${name}/`]
    .flatMap((path) => [
      `[data-item-path=${quote(path)}]`,
      `[data-item-path$=${quote(`/${path}`)}]`,
    ])
    .join(",");
  return `[data-item-type="folder"]:is(${paths}) > [data-item-section="icon"]::after { --file-tree-folder-image: url("${materialIconUrl(materialFolderIcon(icons, name, false))}"); --file-tree-folder-image-open: url("${materialIconUrl(materialFolderIcon(icons, name, true))}"); }`;
}

/** Adds a rule per named folder a tree shows, as rows appear. */
function watchTree(root: ShadowRoot, icons: MaterialIconTable): () => void {
  const seen = new Set<string>();
  let style = root.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute(STYLE_ATTRIBUTE, "");
    root.append(style);
  }
  const sheet = style;
  let frame = 0;
  const scan = () => {
    frame = 0;
    const rules: string[] = [];
    for (const row of root.querySelectorAll<HTMLElement>(
      '[data-item-type="folder"][data-item-path]',
    )) {
      const name = folderNameOfPath(row.dataset.itemPath ?? "").toLowerCase();
      if (seen.has(name) || !(name in icons.folderNames)) continue;
      seen.add(name);
      rules.push(folderRule(icons, name));
    }
    if (rules.length > 0) sheet.append(rules.join("\n"));
  };
  const observer = new MutationObserver(() => {
    frame ||= requestAnimationFrame(scan);
  });
  observer.observe(root, { childList: true, subtree: true });
  scan();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    sheet.remove();
  };
}

/** While Material folders are on, every Pierre tree on the page gets its named folders. */
export function startMaterialFolders(): () => void {
  const icons = materialIconTable();
  if (!icons) return () => {};
  const stops = new Map<Element, () => void>();
  const attach = () => {
    for (const host of document.querySelectorAll(FILE_TREE_TAG_NAME)) {
      if (stops.has(host) || !host.shadowRoot) continue;
      stops.set(host, watchTree(host.shadowRoot, icons));
    }
    for (const [host, stop] of stops) {
      if (!host.isConnected) {
        stop();
        stops.delete(host);
      }
    }
  };
  // A cheap poll for new trees; watching the whole page would wake on every streamed token.
  const timer = setInterval(attach, 1500);
  attach();
  return () => {
    clearInterval(timer);
    for (const stop of stops.values()) stop();
    stops.clear();
  };
}
