// T3 Space fork: the Paper frames the agent screenshotted, under the tool-call
// group. Paper doesn't run on phones, so a tap opens the Paper frame viewer.
import { useAtomValue } from "@effect/atom-react";
import { paperShotBase, type PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import type { EnvironmentId } from "@t3tools/contracts";
import { Image } from "expo-image";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { openPaperViewer } from "./paperFrameViewerState";
import { PaperRain } from "./PaperRain";
import {
  currentPaperThreadShots,
  usePaperDrawingKey,
  usePaperDrawingShot,
  usePaperShotThumbnail,
} from "./paperThreadState";
import {
  MarkdownImageAvailableWidthContext,
  ThreadMarkdownImage,
} from "../threads/ThreadMarkdownImage";

const SHOT_WIDTH = 132;
const PAPER_ICON = require("../../../assets/paper-icon.png");

/** Under the live work, the artboard the agent is drawing until it screenshots it. */
export function PaperDrawingStrip(props: { readonly environmentId: EnvironmentId }) {
  const shot = usePaperDrawingShot();
  return shot === null ? null : (
    <PaperShotsStrip environmentId={props.environmentId} shots={[shot]} />
  );
}

export function PaperShotsStrip(props: {
  readonly environmentId: EnvironmentId;
  readonly shots: ReadonlyArray<PaperShot> | undefined;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const shots = settings?.paperIntegrationEnabled === true ? (props.shots ?? []) : [];
  const drawingKey = usePaperDrawingKey(props.environmentId);
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
  // The viewer pages through the thread's frames, newest first, starting on the one tapped.
  const open = (key: string) => {
    const threadShots = currentPaperThreadShots();
    const frames = threadShots.some((shot) => shot.key === key) ? threadShots : shots;
    openPaperViewer({
      environmentId: props.environmentId,
      index: Math.max(
        0,
        frames.findIndex((shot) => shot.key === key),
      ),
      frames: frames.map((shot) => ({
        key: shot.key,
        fileId: shot.fileId,
        nodeId: shot.nodeId,
        name: nameOf(shot),
        image: shot.image,
        revision: paperShotBase(shot),
        capturedAt: shot.capturedAt,
      })),
    });
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-1 pb-1"
    >
      <MarkdownImageAvailableWidthContext.Provider value={SHOT_WIDTH}>
        {shots.map((shot) => (
          <View key={shot.key} style={{ width: SHOT_WIDTH }}>
            <ShotImage
              environmentId={props.environmentId}
              shot={shot}
              onPress={() => open(shot.key)}
            />
            {shot.key === drawingKey ? (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  paddingHorizontal: 5,
                  paddingVertical: 4,
                  borderRadius: 5,
                  backgroundColor: "rgba(0,0,0,0.75)",
                }}
              >
                <PaperRain />
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={nameOf(shot) ?? `Paper frame ${shot.nodeId}`}
              onPress={() => open(shot.key)}
              className="flex-row items-center gap-1.5"
            >
              <Image source={PAPER_ICON} style={{ width: 14, height: 14, borderRadius: 3 }} />
              <Text numberOfLines={1} className="flex-1 text-xs text-foreground-muted">
                {nameOf(shot) ?? `Paper frame ${shot.nodeId}`}
              </Text>
            </Pressable>
          </View>
        ))}
      </MarkdownImageAvailableWidthContext.Provider>
    </ScrollView>
  );
}

function ShotImage(props: {
  readonly environmentId: EnvironmentId;
  readonly shot: PaperShot;
  readonly onPress: () => void;
}) {
  const thumbnail = usePaperShotThumbnail(props.environmentId, props.shot);
  if (thumbnail.resource === null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the frame being drawn"
        onPress={props.onPress}
        className="items-center justify-center rounded-lg bg-subtle"
        style={{ width: SHOT_WIDTH, height: SHOT_WIDTH * 0.75 }}
      >
        <PaperRain />
      </Pressable>
    );
  }
  return (
    <View>
      <View style={{ opacity: thumbnail.deleted ? 0.55 : 1 }}>
        <ThreadMarkdownImage
          environmentId={props.environmentId}
          resource={thumbnail.resource}
          // The caption below carries the name; the shared one has no icon and wraps.
          alt={null}
          onPressPreview={props.onPress}
        />
      </View>
      {thumbnail.deleted ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            paddingHorizontal: 7,
            paddingVertical: 3,
            borderRadius: 5,
            backgroundColor: "rgba(0,0,0,0.8)",
          }}
        >
          <Text style={{ fontSize: 11, lineHeight: 14, fontWeight: "500", color: DELETED_TEXT }}>
            Deleted in Paper
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const DELETED_TEXT = "#E8C77A";
