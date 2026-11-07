import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_FILE_TREE_LOOK,
  effectiveFileTreeLook,
  fileTreeIconsFor,
  fileTreeLookVariables,
  iconResolverFor,
  type FileTreeLook,
} from "./fileTreeLook";

const look = (patch: Partial<FileTreeLook>): FileTreeLook => ({
  ...DEFAULT_FILE_TREE_LOOK,
  enabled: true,
  ...patch,
});

describe("fileTreeLook", () => {
  it("applies nothing while the Labs flag is off", () => {
    const saved = look({ enabled: false, font: "code", icons: "minimal", inlineExpanded: true });
    expect(effectiveFileTreeLook(saved)).toEqual(DEFAULT_FILE_TREE_LOOK);
    expect(fileTreeLookVariables(effectiveFileTreeLook(saved))).toMatchObject({
      "--file-tree-font-family": null,
      "--file-tree-font-size": null,
      "--file-tree-indent": null,
    });
  });

  it("writes the chosen font, size and indent", () => {
    expect(fileTreeLookVariables(look({ font: "code", fontSize: 13, indent: 12 }))).toMatchObject({
      "--file-tree-font-family": "var(--font-mono)",
      "--file-tree-font-size": "13px",
      "--file-tree-indent": "12px",
    });
  });

  it("sets folder icons only when Folders asks for them", () => {
    expect(fileTreeLookVariables(look({}))["--file-tree-folders"]).toBeNull();
    const icons = fileTreeLookVariables(look({ folders: "icons" }));
    expect(icons["--file-tree-folders"]).toBe("icons");
    expect(icons["--file-tree-folder-mask"]).toContain("data:image/svg+xml");
    const material = fileTreeLookVariables(look({ folders: "both", icons: "material" }));
    expect(material["--file-tree-folder-image"]).toContain("/material-icons/folder.svg");
    expect(material["--file-tree-folder-mask"]).toBeNull();
  });

  it("keeps one icon object per choice so trees only reset on a change", () => {
    expect(fileTreeIconsFor(look({}))).toBe(fileTreeIconsFor(look({ fontSize: 14 })));
    expect(fileTreeIconsFor(look({ icons: "minimal" }))).toMatchObject({ set: "minimal" });
    expect(fileTreeIconsFor(look({ colored: false }))).toMatchObject({ colored: false });
  });

  it("resolves a pack's own icons for rows React renders", () => {
    expect(iconResolverFor(look({}))).toBeNull();
    const minimal = iconResolverFor(look({ icons: "minimal" }))!;
    const complete = iconResolverFor(look({ icons: "complete" }))!;
    expect(minimal.resolveIcon("file-tree-icon-file", "src/a.ts").token).not.toBe("typescript");
    expect(complete.resolveIcon("file-tree-icon-file", "src/a.ts").token).toBe("typescript");
  });
});
