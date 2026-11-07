// T3 Space fork: full-screen Paper frames on the phone (board 03). Swipe between
// frames, pinch or double-tap to zoom, drag to pan, and jump with the strip.
// Paper itself does not run on phones, so this is how a design gets looked at.
// With live frames on, the page on screen swaps to the frame as HTML once it loads.
import { useAtomValue } from "@effect/atom-react";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Image } from "expo-image";
import { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  GestureStateManager,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useAssetUrlState } from "../../state/assets";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { closePaperViewer, paperViewerAtom, type PaperViewerFrame } from "./paperFrameViewerState";
import { PaperLiveFrame } from "./PaperLiveFrame";

const MAX_SCALE = 6;
const STRIP_HEIGHT = 64;

/** The frame's screenshot URL: the thread's own, or a small one fetched from Paper. */
function useFrameImageUrl(environmentId: EnvironmentId, frame: PaperViewerFrame): string | null {
  const fetched = useEnvironmentQuery(
    frame.image === null
      ? serverEnvironment.paper({
          environmentId,
          input: { _tag: "frameImage", fileId: frame.fileId, nodeId: frame.nodeId },
        })
      : null,
  );
  const resource: AssetResource | null =
    frame.image ??
    (fetched.data?._tag === "frameImage"
      ? { _tag: "attachment", attachmentId: fetched.data.attachmentId, disposition: "inline" }
      : null);
  const url = useAssetUrlState(environmentId, resource);
  return url._tag === "Success" ? url.url : null;
}

function ZoomableFrame(props: {
  readonly uri: string | null;
  readonly width: number;
  readonly height: number;
  readonly onZoomedChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const { onZoomedChange } = props;
  const reset = () => {
    "worklet";
    scale.set(withTiming(1));
    savedScale.set(1);
    translateX.set(withTiming(0));
    translateY.set(withTiming(0));
    savedX.set(0);
    savedY.set(0);
    runOnJS(onZoomedChange)(false);
  };
  const pinch = usePinchGesture({
    onUpdate: (event) => {
      scale.set(Math.min(MAX_SCALE, Math.max(1, savedScale.get() * event.scale)));
    },
    onDeactivate: () => {
      savedScale.set(scale.get());
      if (scale.get() <= 1.01) reset();
      else runOnJS(onZoomedChange)(true);
    },
  });
  // Drags pan only while zoomed; otherwise they fail so the swipe pages between frames.
  const pan = usePanGesture({
    manualActivation: true,
    onTouchesMove: (event) => {
      if (scale.get() > 1) GestureStateManager.activate(event.handlerTag);
      else GestureStateManager.fail(event.handlerTag);
    },
    onUpdate: (event) => {
      translateX.set(savedX.get() + event.translationX);
      translateY.set(savedY.get() + event.translationY);
    },
    onDeactivate: () => {
      savedX.set(translateX.get());
      savedY.set(translateY.get());
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: () => {
      if (scale.get() > 1) {
        reset();
        return;
      }
      scale.set(withTiming(2.5));
      savedScale.set(2.5);
      runOnJS(onZoomedChange)(true);
    },
  });
  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width: props.width, height: props.height }, style]}>
        {props.uri !== null ? (
          <Image
            source={{ uri: props.uri }}
            contentFit="contain"
            style={{ width: props.width, height: props.height }}
          />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

function FramePage(props: {
  readonly environmentId: EnvironmentId;
  readonly frame: PaperViewerFrame;
  readonly width: number;
  readonly height: number;
  readonly live: boolean;
  readonly onZoomedChange: (zoomed: boolean) => void;
  readonly onSwipe: (direction: 1 | -1) => void;
}) {
  const uri = useFrameImageUrl(props.environmentId, props.frame);
  const [liveReady, setLiveReady] = useState(false);
  const showLive = props.live && liveReady;
  return (
    <View
      style={{ width: props.width, height: props.height }}
      className="items-center justify-center overflow-hidden"
    >
      {showLive ? null : (
        <ZoomableFrame
          uri={uri}
          width={props.width}
          height={props.height}
          onZoomedChange={props.onZoomedChange}
        />
      )}
      {props.live ? (
        <PaperLiveFrame
          environmentId={props.environmentId}
          frame={props.frame}
          visible={showLive}
          onReady={() => {
            setLiveReady(true);
            props.onZoomedChange(false);
          }}
          onZoomedChange={props.onZoomedChange}
          onSwipe={props.onSwipe}
        />
      ) : null}
    </View>
  );
}

function StripThumb(props: {
  readonly environmentId: EnvironmentId;
  readonly frame: PaperViewerFrame;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const uri = useFrameImageUrl(props.environmentId, props.frame);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.frame.name ?? `Frame ${props.frame.nodeId}`}
      onPress={props.onPress}
      className={
        props.selected
          ? "h-12 w-16 overflow-hidden rounded-md border-2 border-primary"
          : "h-12 w-16 overflow-hidden rounded-md border border-border opacity-70"
      }
    >
      {uri !== null ? (
        <Image source={{ uri }} contentFit="cover" contentPosition="top" style={{ flex: 1 }} />
      ) : null}
    </Pressable>
  );
}

export function PaperFrameViewerHost() {
  const state = useAtomValue(paperViewerAtom);
  if (state === null) return null;
  return <PaperFrameViewer key={`${state.frames[state.index]?.key}`} {...state} />;
}

function PaperFrameViewer(props: {
  readonly environmentId: EnvironmentId;
  readonly frames: ReadonlyArray<PaperViewerFrame>;
  readonly index: number;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [index, setIndex] = useState(props.index);
  const [zoomed, setZoomed] = useState(false);
  const [list, setList] = useState<FlatList<PaperViewerFrame> | null>(null);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const liveEnabled = settings?.paperLiveFramesEnabled === true;
  const pageHeight = window.height - insets.top - insets.bottom - 56 - STRIP_HEIGHT;
  const current = props.frames[index];
  const goTo = (next: number) => {
    setIndex(next);
    list?.scrollToIndex({ index: next, animated: true });
  };
  return (
    <Modal
      animationType="fade"
      onRequestClose={closePaperViewer}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* Modals render outside the app's gesture root on Android. */}
      <GestureHandlerRootView
        className="flex-1 bg-card"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <SheetHeader
          presentation="inline"
          title={current?.name ?? "Paper frame"}
          onClose={closePaperViewer}
        />
        <FlatList
          ref={setList}
          data={props.frames}
          keyExtractor={(frame) => frame.key}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={props.index}
          getItemLayout={(_, item) => ({
            length: window.width,
            offset: window.width * item,
            index: item,
          })}
          onMomentumScrollEnd={(event) =>
            setIndex(Math.round(event.nativeEvent.contentOffset.x / window.width))
          }
          extraData={index}
          renderItem={({ item, index: position }) => (
            <FramePage
              environmentId={props.environmentId}
              frame={item}
              width={window.width}
              height={pageHeight}
              // Only the page on screen goes live; each live frame costs Paper calls.
              live={liveEnabled && position === index}
              onSwipe={(direction) => {
                const next = position + direction;
                if (next >= 0 && next < props.frames.length) goTo(next);
              }}
              onZoomedChange={setZoomed}
            />
          )}
        />
        <View style={{ height: STRIP_HEIGHT }} className="justify-center">
          {props.frames.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="items-center gap-2 px-4"
            >
              {props.frames.map((frame, position) => (
                <StripThumb
                  key={frame.key}
                  environmentId={props.environmentId}
                  frame={frame}
                  selected={position === index}
                  onPress={() => goTo(position)}
                />
              ))}
            </ScrollView>
          ) : (
            <Text className="text-center text-xs text-muted-foreground">
              {liveEnabled ? "Pinch to zoom · live frame" : "Pinch or double-tap to zoom"}
            </Text>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
