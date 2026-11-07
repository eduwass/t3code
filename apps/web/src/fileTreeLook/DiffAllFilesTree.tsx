// T3 Space fork: a diff's file tree can list every project file, not only the changed ones.
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { FileDiffIcon, FolderOpenIcon } from "lucide-react";
import { type ComponentProps, lazy, Suspense } from "react";

import { DiffFileTree } from "../components/diffs/DiffFileTree";
import { useRightPanelStore } from "../rightPanelStore";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { Toggle } from "../components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useFileTreeLook } from "./fileTreeLook";

// Loaded only when someone switches to all files.
const FileBrowserPanel = lazy(() => import("../components/files/FileBrowserPanel"));

const STORAGE_KEY = "t3code:diff-file-tree-all-files:v1";

function useDiffTreeAllFiles() {
  const { diffAllFilesToggle } = useFileTreeLook();
  const [allFiles, setAllFiles] = useLocalStorage(STORAGE_KEY, false, Schema.Boolean);
  return { available: diffAllFilesToggle, allFiles: diffAllFilesToggle && allFiles, setAllFiles };
}

function DiffTreeScopeToggle(props: {
  allFiles: boolean;
  onAllFilesChange: (allFiles: boolean) => void;
}) {
  const label = props.allFiles ? "Show changed files only" : "Show all files";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={label}
            variant="ghost"
            size="xs"
            pressed={props.allFiles}
            onPressedChange={(pressed) => props.onAllFilesChange(Boolean(pressed))}
          />
        }
      >
        {props.allFiles ? (
          <FileDiffIcon className="size-3.5" />
        ) : (
          <FolderOpenIcon className="size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** The diff's file tree, with a button that swaps in the full project tree. */
export function DiffAllFilesTree(
  props: ComponentProps<typeof DiffFileTree> & {
    project: {
      environmentId: EnvironmentId;
      cwd: string;
      name: string;
      threadRef: ScopedThreadRef;
      workspaceMutationId: string | null;
    } | null;
    /** Returns false when the path has no diff here. */
    revealDiffFile: (path: string) => boolean;
  },
) {
  const { project, revealDiffFile, ...treeProps } = props;
  const { available, allFiles, setAllFiles } = useDiffTreeAllFiles();
  const toggle =
    available && project ? (
      <DiffTreeScopeToggle allFiles={allFiles} onAllFilesChange={setAllFiles} />
    ) : null;
  if (!allFiles || !project) return <DiffFileTree {...treeProps} headerAccessory={toggle} />;
  return (
    <Suspense fallback={null}>
      <FileBrowserPanel
        environmentId={project.environmentId}
        cwd={project.cwd}
        projectName={project.name}
        selectedPath={treeProps.selectedPath ?? null}
        selectedPathRevealId={treeProps.revealRequestId ?? 0}
        onOpenFile={(path) => {
          if (!revealDiffFile(path))
            useRightPanelStore.getState().openFile(project.threadRef, path);
        }}
        workspaceMutationId={project.workspaceMutationId}
        headerAccessory={toggle}
      />
    </Suspense>
  );
}
