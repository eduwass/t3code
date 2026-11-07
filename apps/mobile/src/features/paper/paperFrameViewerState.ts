// T3 Space fork: which Paper frames the viewer shows. One module-level atom, so the
// strip and the chips can open the single viewer mounted at the app root.
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { parseContextId } from "@t3tools/client-runtime/work-log/paper-frame-references";

import { appAtomRegistry } from "../../state/atom-registry";

export interface PaperViewerFrame {
  readonly key: string;
  readonly fileId: string;
  readonly nodeId: string;
  readonly name: string | null;
  /** The thread's screenshot; without one the viewer fetches a small one from Paper. */
  readonly image: AssetResource | null;
  /** The screenshot's tool item, so a newer drawing fetches a new live frame. */
  readonly revision: string | null;
}

export interface PaperViewerState {
  readonly environmentId: EnvironmentId;
  readonly frames: ReadonlyArray<PaperViewerFrame>;
  readonly index: number;
}

export const paperViewerAtom = Atom.make<PaperViewerState | null>(null).pipe(Atom.keepAlive);

export function openPaperViewer(state: PaperViewerState): void {
  appAtomRegistry.set(paperViewerAtom, state);
}

export function closePaperViewer(): void {
  appAtomRegistry.set(paperViewerAtom, null);
}

/** Opens the frame a `paper-frame` chip points at; its screenshot is fetched from Paper. */
export function openPaperFrameReference(
  environmentId: EnvironmentId,
  contextId: string,
  label: string,
): void {
  const frame = parseContextId(contextId);
  if (frame === null) return;
  openPaperViewer({
    environmentId,
    index: 0,
    frames: [{ key: contextId, ...frame, name: label, image: null, revision: null }],
  });
}
