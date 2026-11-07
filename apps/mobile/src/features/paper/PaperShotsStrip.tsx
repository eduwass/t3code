// T3 Space fork: the Paper frames the agent screenshotted, under the tool-call
// group. Paper doesn't run on phones, so a tap opens the zoomable preview.
import { useAtomValue } from "@effect/atom-react";
import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import type { EnvironmentId } from "@t3tools/contracts";
import { ScrollView, View } from "react-native";

import type { FilePreviewSource } from "../../components/FilePreviewModal";
import { serverEnvironment } from "../../state/server";
import {
  MarkdownImageAvailableWidthContext,
  ThreadMarkdownImage,
} from "../threads/ThreadMarkdownImage";

const SHOT_WIDTH = 132;

export function PaperShotsStrip(props: {
  readonly environmentId: EnvironmentId;
  readonly shots: ReadonlyArray<PaperShot> | undefined;
  readonly onPressPreview: (source: FilePreviewSource) => void;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  if (settings?.paperIntegrationEnabled !== true || !props.shots?.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-1 pb-1"
    >
      <MarkdownImageAvailableWidthContext.Provider value={SHOT_WIDTH}>
        {props.shots.map((shot) => (
          <View key={shot.key} style={{ width: SHOT_WIDTH }}>
            <ThreadMarkdownImage
              environmentId={props.environmentId}
              resource={shot.image}
              alt={`Paper frame ${shot.nodeId}`}
              onPressPreview={props.onPressPreview}
            />
          </View>
        ))}
      </MarkdownImageAvailableWidthContext.Provider>
    </ScrollView>
  );
}
