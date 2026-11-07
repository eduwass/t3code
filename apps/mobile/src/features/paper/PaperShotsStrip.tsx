// T3 Space fork: the Paper frames the agent screenshotted, under the tool-call
// group. Paper doesn't run on phones, so a tap opens the Paper frame viewer.
import { useAtomValue } from "@effect/atom-react";
import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import type { EnvironmentId } from "@t3tools/contracts";
import { ScrollView, View } from "react-native";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { openPaperViewer } from "./paperFrameViewerState";
import {
  MarkdownImageAvailableWidthContext,
  ThreadMarkdownImage,
} from "../threads/ThreadMarkdownImage";

const SHOT_WIDTH = 132;

export function PaperShotsStrip(props: {
  readonly environmentId: EnvironmentId;
  readonly shots: ReadonlyArray<PaperShot> | undefined;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const shots = settings?.paperIntegrationEnabled === true ? (props.shots ?? []) : [];
  // Names need the server to reach Paper; without it the viewer titles stay generic.
  const names = useEnvironmentQuery(
    shots.length > 0
      ? serverEnvironment.paper({
          environmentId: props.environmentId,
          input: {
            _tag: "frameNames",
            frames: shots.slice(0, 64).map(({ fileId, nodeId }) => ({ fileId, nodeId })),
          },
        })
      : null,
  );
  if (shots.length === 0) return null;
  const nameOf = (shot: PaperShot) =>
    names.data?._tag === "frameNames"
      ? (names.data.frames.find(
          (frame) => frame.fileId === shot.fileId && frame.nodeId === shot.nodeId,
        )?.name ?? null)
      : null;
  const open = (index: number) =>
    openPaperViewer({
      environmentId: props.environmentId,
      index,
      frames: shots.map((shot) => ({
        key: shot.key,
        fileId: shot.fileId,
        nodeId: shot.nodeId,
        name: nameOf(shot),
        image: shot.image,
        revision: shot.image.itemId,
      })),
    });
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-1 pb-1"
    >
      <MarkdownImageAvailableWidthContext.Provider value={SHOT_WIDTH}>
        {shots.map((shot, index) => (
          <View key={shot.key} style={{ width: SHOT_WIDTH }}>
            <ThreadMarkdownImage
              environmentId={props.environmentId}
              resource={shot.image}
              alt={nameOf(shot) ?? `Paper frame ${shot.nodeId}`}
              onPressPreview={() => open(index)}
            />
          </View>
        ))}
      </MarkdownImageAvailableWidthContext.Provider>
    </ScrollView>
  );
}
