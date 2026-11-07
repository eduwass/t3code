// T3 Space fork: Paper frames in the phone composer's @ menu, matching the web one.
// A picked frame becomes a `paper-frame` chip whose record goes into the draft.
import { useAtomValue } from "@effect/atom-react";
import {
  buildPaperFrameMenuItems,
  type PaperFrameMenuItem,
} from "@t3tools/client-runtime/work-log/paper-frame-references";
import { paperShotsFromProjectedItems } from "@t3tools/client-runtime/work-log/paper-tools";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { Image } from "expo-image";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { useAssetUrlState } from "../../state/assets";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useSelectedThreadVisibleTurnItems } from "../../state/use-thread-detail";

const NO_SETTINGS = Atom.make(null);

export type MobilePaperFrameMenuItem = PaperFrameMenuItem & {
  readonly environmentId: EnvironmentId;
};

/** Frames drawn in this thread first, then the rest of those Paper files. */
export function usePaperFrameMenuItems(input: {
  readonly environmentId: EnvironmentId | null;
  readonly query: string | null;
}): ReadonlyArray<MobilePaperFrameMenuItem> {
  const { environmentId } = input;
  const settings = useAtomValue(
    environmentId === null ? NO_SETTINGS : serverEnvironment.settingsValueAtom(environmentId),
  );
  const active =
    environmentId !== null && input.query !== null && settings?.paperIntegrationEnabled === true;
  const turnItems = useSelectedThreadVisibleTurnItems();
  const shots = active ? [...paperShotsFromProjectedItems(turnItems)].reverse() : [];
  const fileIds = [...new Set(shots.map((shot) => shot.fileId))];
  const listFrames = (fileId: string | undefined) =>
    active && fileId !== undefined
      ? serverEnvironment.paper({ environmentId, input: { _tag: "listFrames", fileId } })
      : null;
  const firstFile = useEnvironmentQuery(listFrames(fileIds[0]));
  const secondFile = useEnvironmentQuery(listFrames(fileIds[1]));
  const shotNames = useEnvironmentQuery(
    active && shots.length > 0
      ? serverEnvironment.paper({
          environmentId,
          input: {
            _tag: "frameNames",
            frames: shots.slice(0, 64).map(({ fileId, nodeId }) => ({ fileId, nodeId })),
          },
        })
      : null,
  );
  if (!active) return [];
  return buildPaperFrameMenuItems({
    shots,
    files: [firstFile.data, secondFile.data],
    shotNames: shotNames.data,
    query: input.query ?? "",
  }).map((item) => ({ ...item, environmentId }));
}

/** The row's thumbnail: the thread's screenshot, or a small one fetched from Paper. */
export function PaperFrameRowThumb(props: { readonly item: MobilePaperFrameMenuItem }) {
  const { frame, environmentId } = props.item;
  const fetched = useEnvironmentQuery(
    frame.shot === null
      ? serverEnvironment.paper({
          environmentId,
          input: { _tag: "frameImage", fileId: frame.fileId, nodeId: frame.nodeId },
        })
      : null,
  );
  const resource: AssetResource | null =
    frame.shot?.image ??
    (fetched.data?._tag === "frameImage"
      ? { _tag: "attachment", attachmentId: fetched.data.attachmentId, disposition: "inline" }
      : null);
  const url = useAssetUrlState(environmentId, resource);
  return (
    <View className="h-8 w-12 items-center justify-center overflow-hidden rounded bg-subtle">
      {url._tag === "Success" ? (
        <Image
          source={{ uri: url.url }}
          contentFit="cover"
          contentPosition="top"
          style={{ width: 48, height: 32 }}
        />
      ) : (
        <SymbolView
          name="photo"
          size={14}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      )}
    </View>
  );
}
