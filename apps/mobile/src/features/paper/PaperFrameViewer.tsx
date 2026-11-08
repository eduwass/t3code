// T3 Space fork: full-screen Paper frames on the phone, styled after board 10 in the
// T3 Space × Paper file. A dark canvas like Paper's; swipe or the filmstrip moves between
// the thread's frames, the file name opens the full list, and pinching in hides the bars.
// With live frames on, the page on screen swaps to the frame as HTML once it loads.
import { useAtomValue } from "@effect/atom-react";
import { paperNodeUrl } from "@t3tools/client-runtime/work-log/paper-tools";
import type { AssetResource, EnvironmentId, PaperFrame } from "@t3tools/contracts";
import { Image } from "expo-image";
import { useEffect, useEffectEvent, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
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
  FadeIn,
  FadeOut,
  runOnJS,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useAssetUrlState } from "../../state/assets";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { closePaperViewer, paperViewerAtom, type PaperViewerFrame } from "./paperFrameViewerState";
import { PaperLiveFrame } from "./PaperLiveFrame";
import { PaperRain } from "./PaperRain";
import { usePaperLiveFrame } from "./usePaperLiveFrame";
import { usePaperDrawingKey, usePaperFrameRevision, usePaperFreshImage } from "./paperThreadState";

const PAPER_ICON = require("../../../assets/paper-icon.png");
const DRAWING_TEXT = "#9DB4F0";
const C = {
  canvas: "#181818",
  panel: "#1C1C1C",
  button: "#262626",
  text: "#EDEDED",
  control: "#B4B4B4",
  muted: "#8C8C8C",
  faint: "#5C5C5C",
  detail: "#6E6E6E",
  selected: "#2A2A2A",
  divider: "#383838",
  handle: "#3A3A3A",
  frame: "#F4F4F4",
  accent: "#2F6BFF",
  ink: "#141414",
} as const;
const MAX_SCALE = 6;
const MARGIN = 16;
const TOP_BAR = 52;
const LABEL = 24;
const THUMB = { width: 52, height: 38 } as const;
// Count row, filmstrip and the gaps around them.
const BOTTOM_BARS = 18 + 12 + THUMB.height + 22;

/** "Captured just now", "Captured 4 min ago", "Captured 2 h ago", "Captured yesterday". */
export function capturedLabel(capturedAt: number | null, now: number): string | null {
  if (capturedAt === null) return null;
  const minutes = Math.floor(Math.max(0, now - capturedAt) / 60_000);
  if (minutes < 1) return "Captured just now";
  if (minutes < 60) return `Captured ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Captured ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Captured yesterday" : `Captured ${days} days ago`;
}

/** The frame's screenshot URL: the thread's own, or a small one fetched from Paper. */
function useFrameImageUrl(environmentId: EnvironmentId, frame: PaperViewerFrame): string | null {
  const revision = usePaperFrameRevision(environmentId, frame);
  const fresh = usePaperFreshImage(environmentId, frame, frame.revision, revision);
  const fetched = useEnvironmentQuery(
    frame.image === null
      ? serverEnvironment.paper({
          environmentId,
          input: { _tag: "frameImage", fileId: frame.fileId, nodeId: frame.nodeId },
        })
      : null,
  );
  const resource: AssetResource | null =
    fresh ??
    frame.image ??
    (fetched.data?._tag === "frameImage"
      ? { _tag: "attachment", attachmentId: fetched.data.attachmentId, disposition: "inline" }
      : null);
  const url = useAssetUrlState(environmentId, resource);
  return url._tag === "Success" ? url.url : null;
}

function Glyph(props: { readonly d: string; readonly color: string; readonly size?: number }) {
  const size = props.size ?? 14;
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d={props.d}
        stroke={props.color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The screenshot, fitted inside the canvas; pinch and double-tap zoom it. */
function ZoomableFrame(props: {
  readonly uri: string | null;
  /** An empty outline at the frame's size while the live frame loads. */
  readonly blank: boolean;
  readonly width: number;
  readonly height: number;
  readonly onZoomChange: (zoomed: boolean, scale: number) => void;
  readonly onAspect: (aspect: number) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const { onZoomChange } = props;
  const reset = () => {
    "worklet";
    scale.set(withTiming(1));
    savedScale.set(1);
    translateX.set(withTiming(0));
    translateY.set(withTiming(0));
    savedX.set(0);
    savedY.set(0);
    runOnJS(onZoomChange)(false, 1);
  };
  const pinch = usePinchGesture({
    onUpdate: (event) => {
      scale.set(Math.min(MAX_SCALE, Math.max(1, savedScale.get() * event.scale)));
      runOnJS(onZoomChange)(scale.get() > 1.01, scale.get());
    },
    onDeactivate: () => {
      savedScale.set(scale.get());
      if (scale.get() <= 1.01) reset();
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
      runOnJS(onZoomChange)(true, 2.5);
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
      <Animated.View
        style={[
          {
            width: props.width,
            height: props.height,
            backgroundColor: props.blank ? "transparent" : C.frame,
            borderWidth: props.blank ? 1 : 0,
            borderColor: C.button,
            shadowColor: "#000",
            shadowOpacity: props.blank ? 0 : 0.5,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 14 },
          },
          style,
        ]}
      >
        {props.uri !== null && !props.blank ? (
          <Image
            source={{ uri: props.uri }}
            contentFit="contain"
            style={{ width: props.width, height: props.height }}
            onLoad={(event) => {
              const { width, height } = event.source;
              if (width > 0 && height > 0) props.onAspect(height / width);
            }}
          />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

function FramePage(props: {
  readonly environmentId: EnvironmentId;
  readonly frame: PaperViewerFrame;
  readonly meta: PaperFrame | null;
  readonly width: number;
  readonly height: number;
  readonly insetTop: number;
  readonly insetBottom: number;
  /** Live frames are on: pages open blank at the frame's size, never on the screenshot. */
  readonly liveFrames: boolean;
  readonly live: boolean;
  /** Next to the page on screen. */
  readonly near: boolean;
  readonly chromeHidden: boolean;
  readonly now: number;
  readonly onZoomChange: (zoomed: boolean, percent: number) => void;
  readonly onSwipe: (direction: 1 | -1) => void;
}) {
  const uri = useFrameImageUrl(props.environmentId, props.frame);
  const revision = usePaperFrameRevision(props.environmentId, props.frame);
  const drawing = usePaperDrawingKey(props.environmentId) === props.frame.key;
  // Same request the newest live frame makes; failing means deleted in Paper or Paper unreachable.
  // The pages beside the one on screen fetch it too, so swiping to them opens at once.
  const latest = usePaperLiveFrame(
    props.environmentId,
    props.live || props.near ? props.frame : null,
    revision,
  );
  const [live, setLive] = useState<{ width: number; height: number; scale: number } | null>(null);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  // Bumped to reload the live frame at fit after a double-tap; the ready one stays up until the new one is.
  // Newer drawings swap into the open page instead, keeping zoom and scroll.
  const [liveLoad, setLiveLoad] = useState(0);
  const [readyLoad, setReadyLoad] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  // The pages beside the one on screen draw too, so a swipe lands on a finished page.
  const mounted = props.live || props.near;
  if (!mounted && readyLoad !== null) setReadyLoad(null);
  // A zoomed page swiped away reloads at fit, so it is not still zoomed when it comes back.
  if (!props.live && zoomed) {
    setZoomed(false);
    setLiveLoad(liveLoad + 1);
  }
  const fitScale = live?.scale ?? null;
  const reportFit = useEffectEvent((scale: number) => props.onZoomChange(false, scale * 100));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a page drawn beside the screen reports its fit scale when it becomes the one shown
  useEffect(() => {
    if (props.live && fitScale !== null) reportFit(fitScale);
  }, [props.live, fitScale]);
  const known =
    props.meta?.width && props.meta.height ? props.meta.height / props.meta.width : null;
  const aspect = live !== null ? live.height / live.width : (known ?? imageAspect ?? 0.62);
  const realWidth = live?.width ?? props.meta?.width ?? null;
  const boxWidth = Math.min(props.width - MARGIN * 2, realWidth ?? Number.POSITIVE_INFINITY);
  const boxHeight = boxWidth * aspect;
  const region = props.height - props.insetTop - props.insetBottom;
  // The frame centers between the bars; a tall one starts at the top and scrolls.
  const top = props.insetTop + Math.max(0, (region - boxHeight) / 2);
  const showLive = mounted && live !== null && readyLoad !== null;
  // The screenshot is only the fallback, for when Paper cannot render the frame live.
  const blank = props.liveFrames && !(props.live && latest.error !== null && readyLoad === null);
  const fitPercent = realWidth === null ? null : (boxWidth / realWidth) * 100;
  const detail = capturedLabel(props.frame.capturedAt, props.now);
  return (
    <View style={{ width: props.width, height: props.height, overflow: "hidden" }}>
      {showLive ? null : (
        <View style={{ position: "absolute", top, left: (props.width - boxWidth) / 2 }}>
          <ZoomableFrame
            uri={uri}
            blank={blank}
            width={boxWidth}
            height={boxHeight}
            onAspect={setImageAspect}
            onZoomChange={(zoomed, scale) =>
              props.onZoomChange(zoomed, fitPercent === null ? 0 : fitPercent * scale)
            }
          />
        </View>
      )}
      {mounted
        ? [...new Set([readyLoad ?? liveLoad, liveLoad])].map((load) => (
            <PaperLiveFrame
              key={load}
              environmentId={props.environmentId}
              frame={{ ...props.frame, revision }}
              visible={showLive && load === readyLoad}
              insetTop={props.insetTop}
              insetBottom={props.insetBottom}
              onReady={(size) => {
                setLive(size);
                setReadyLoad(load);
                props.onZoomChange(false, size.scale * 100);
              }}
              onResize={(size) => setLive((prev) => (prev === null ? prev : { ...prev, ...size }))}
              onZoomChange={(next, scale) => {
                setZoomed(next);
                props.onZoomChange(next, scale * 100);
              }}
              onFit={() => setLiveLoad(load + 1)}
              onSwipe={props.onSwipe}
            />
          ))
        : null}
      {props.chromeHidden ? null : (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: MARGIN,
            right: MARGIN,
            top: top - LABEL,
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontSize: 12, lineHeight: 16, color: C.muted }}
          >
            {props.meta?.name ?? props.frame.name ?? "Paper frame"}
          </Text>
          {latest.error !== null && readyLoad !== null ? (
            <Text style={{ fontSize: 12, lineHeight: 16, color: C.faint }}>
              Couldn't update · last version
            </Text>
          ) : drawing ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <PaperRain />
              <Text style={{ fontSize: 12, lineHeight: 16, color: DRAWING_TEXT }}>Drawing now</Text>
            </View>
          ) : detail !== null ? (
            <Text style={{ fontSize: 12, lineHeight: 16, color: C.faint }}>{detail}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Thumb(props: {
  readonly environmentId: EnvironmentId;
  readonly frame: PaperViewerFrame;
  readonly width: number;
  readonly height: number;
  readonly selected: boolean;
  readonly ring: number;
  readonly dim: number;
}) {
  const uri = useFrameImageUrl(props.environmentId, props.frame);
  return (
    <View
      style={{
        width: props.width,
        height: props.height,
        borderRadius: 6,
        overflow: "hidden",
        backgroundColor: C.frame,
        opacity: props.selected ? 1 : props.dim,
        borderWidth: props.selected ? props.ring : 0,
        borderColor: C.accent,
      }}
    >
      {uri !== null ? (
        <Image source={{ uri }} contentFit="cover" contentPosition="top" style={{ flex: 1 }} />
      ) : null}
    </View>
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
  const [zoom, setZoom] = useState<{ zoomed: boolean; percent: number }>({
    zoomed: false,
    percent: 0,
  });
  const [listOpen, setListOpen] = useState(false);
  const drawingKey = usePaperDrawingKey(props.environmentId);
  const [list, setList] = useState<FlatList<PaperViewerFrame> | null>(null);
  const [now] = useState(() => Date.now());
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const liveEnabled = settings?.paperLiveFramesEnabled === true;
  const current = props.frames[index] ?? props.frames[0];
  const names = useEnvironmentQuery(
    serverEnvironment.paper({
      environmentId: props.environmentId,
      input: {
        _tag: "frameNames",
        frames: props.frames.slice(0, 64).map(({ fileId, nodeId }) => ({ fileId, nodeId })),
      },
    }),
  );
  const file = useEnvironmentQuery(
    current === undefined
      ? null
      : serverEnvironment.paper({
          environmentId: props.environmentId,
          input: { _tag: "listFrames", fileId: current.fileId },
        }),
  );
  if (current === undefined) return null;
  const metaOf = (frame: PaperViewerFrame) =>
    names.data?._tag === "frameNames"
      ? (names.data.frames.find(
          (meta) => meta.fileId === frame.fileId && meta.nodeId === frame.nodeId,
        ) ?? null)
      : null;
  const nameOf = (frame: PaperViewerFrame) => metaOf(frame)?.name ?? frame.name ?? "Paper frame";
  const fileName = file.data?._tag === "listFrames" ? file.data.fileName : null;
  const chromeHidden = zoom.zoomed;
  const insetTop = insets.top + TOP_BAR + LABEL + 8;
  const insetBottom = insets.bottom + BOTTOM_BARS;
  const goTo = (next: number) => {
    setIndex(next);
    setZoom({ zoomed: false, percent: 0 });
    list?.scrollToIndex({ index: next, animated: true });
  };

  return (
    // Closing unmounts the contents mid-fade; an opaque Modal would fade out its white backing.
    <Modal
      animationType="fade"
      transparent
      onRequestClose={closePaperViewer}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* Modals render outside the app's gesture root on Android. */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.canvas }}>
        <FlatList
          ref={setList}
          data={props.frames}
          keyExtractor={(frame) => frame.key}
          horizontal
          pagingEnabled
          scrollEnabled={!zoom.zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={props.index}
          getItemLayout={(_, item) => ({
            length: window.width,
            offset: window.width * item,
            index: item,
          })}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / window.width);
            if (next !== index) {
              setIndex(next);
              setZoom({ zoomed: false, percent: 0 });
            }
          }}
          extraData={{ index, chromeHidden, names: names.data }}
          renderItem={({ item, index: position }) => (
            <FramePage
              environmentId={props.environmentId}
              frame={item}
              meta={metaOf(item)}
              width={window.width}
              height={window.height}
              insetTop={insetTop}
              insetBottom={insetBottom}
              // Only the page on screen goes live; each live frame costs Paper calls.
              liveFrames={liveEnabled}
              live={liveEnabled && position === index}
              near={liveEnabled && Math.abs(position - index) === 1}
              chromeHidden={chromeHidden}
              now={now}
              onSwipe={(direction) => {
                const next = position + direction;
                if (next >= 0 && next < props.frames.length) goTo(next);
              }}
              onZoomChange={(zoomed, percent) => {
                if (position === index) setZoom({ zoomed, percent });
              }}
            />
          )}
        />

        {chromeHidden ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(160)}
            pointerEvents="box-none"
            style={{
              position: "absolute",
              top: insets.top + 14,
              left: 0,
              right: 0,
              alignItems: "center",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="All frames"
              onPress={() => setListOpen(true)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                height: 34,
                paddingHorizontal: 14,
                borderRadius: 17,
                backgroundColor: "rgba(24,24,24,0.88)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              {zoom.percent > 0 ? (
                <>
                  <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "600", color: C.text }}>
                    {Math.round(zoom.percent)}%
                  </Text>
                  <View style={{ width: 1, height: 14, backgroundColor: C.divider }} />
                </>
              ) : null}
              <Text style={{ fontSize: 13, lineHeight: 18, color: C.muted }}>
                Double-tap to fit
              </Text>
            </Pressable>
          </Animated.View>
        ) : (
          <>
            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(160)}
              style={{
                position: "absolute",
                top: insets.top,
                left: 0,
                right: 0,
                height: TOP_BAR,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 12,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={closePaperViewer}
                hitSlop={6}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: C.button,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Glyph d="M3.5 3.5l7 7M10.5 3.5l-7 7" color={C.control} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="All frames"
                onPress={() => setListOpen(true)}
                style={{
                  flexShrink: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 8,
                }}
              >
                <Image source={PAPER_ICON} style={{ width: 20, height: 20 }} />
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    fontSize: 15,
                    lineHeight: 20,
                    fontWeight: "600",
                    color: C.text,
                  }}
                >
                  {fileName ?? "Paper"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open in Paper"
                onPress={() =>
                  void tryOpenExternalUrl(
                    paperNodeUrl(current.fileId, current.nodeId),
                    "markdown-link",
                  )
                }
                hitSlop={6}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: C.text,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Glyph d="M4.7 3.5h5.8v5.8M10.5 3.5L4 10" color={C.ink} />
              </Pressable>
            </Animated.View>

            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(160)}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: insets.bottom + 10,
                gap: 12,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="All frames"
                onPress={() => setListOpen(true)}
                style={{ alignSelf: "flex-end", paddingHorizontal: MARGIN }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 16,
                    color: C.faint,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {index + 1} / {props.frames.length}
                </Text>
              </Pressable>
              {props.frames.length > 1 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: MARGIN, paddingVertical: 2 }}
                >
                  {props.frames.map((frame, position) => (
                    <Pressable
                      key={frame.key}
                      accessibilityRole="button"
                      accessibilityLabel={nameOf(frame)}
                      onPress={() => goTo(position)}
                    >
                      <Thumb
                        environmentId={props.environmentId}
                        frame={frame}
                        width={THUMB.width}
                        height={THUMB.height}
                        selected={position === index}
                        ring={2}
                        dim={0.7}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              ) : (
                <View style={{ height: THUMB.height }} />
              )}
            </Animated.View>
          </>
        )}

        {listOpen ? (
          <>
            <Animated.View
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(180)}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            >
              <Pressable
                accessibilityLabel="Close the frame list"
                onPress={() => setListOpen(false)}
                style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
              />
            </Animated.View>
            <Animated.View
              entering={SlideInDown.duration(220)}
              exiting={SlideOutDown.duration(200)}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                maxHeight: window.height * 0.7,
                paddingTop: 10,
                paddingHorizontal: 10,
                paddingBottom: insets.bottom + 16,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                backgroundColor: C.panel,
                borderWidth: 1,
                borderColor: C.button,
              }}
            >
              <View style={{ alignItems: "center", paddingBottom: 10 }}>
                <View
                  style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: C.handle }}
                />
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 10,
                  paddingBottom: 10,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Image source={PAPER_ICON} style={{ width: 20, height: 20 }} />
                  <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: "600", color: C.text }}>
                    From this thread
                  </Text>
                </View>
                <Text style={{ fontSize: 13, lineHeight: 18, color: C.faint }}>
                  {props.frames.length === 1 ? "1 frame" : `${props.frames.length} frames`}
                </Text>
              </View>
              <ScrollView contentContainerStyle={{ gap: 2 }}>
                {props.frames.map((frame, position) => {
                  const selected = position === index;
                  const detail = capturedLabel(frame.capturedAt, now);
                  return (
                    <Pressable
                      key={frame.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        setListOpen(false);
                        goTo(position);
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        padding: 10,
                        borderRadius: 12,
                        backgroundColor: selected ? C.selected : "transparent",
                      }}
                    >
                      <Thumb
                        environmentId={props.environmentId}
                        frame={frame}
                        width={64}
                        height={42}
                        selected={selected}
                        ring={2}
                        dim={0.85}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontSize: 15,
                            lineHeight: 20,
                            color: selected ? C.text : C.control,
                          }}
                        >
                          {nameOf(frame)}
                        </Text>
                        {frame.key === drawingKey ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                            <PaperRain />
                            <Text style={{ fontSize: 13, lineHeight: 18, color: DRAWING_TEXT }}>
                              Drawing now
                            </Text>
                          </View>
                        ) : detail !== null ? (
                          <Text
                            style={{
                              fontSize: 13,
                              lineHeight: 18,
                              color: selected ? C.detail : C.faint,
                            }}
                          >
                            {detail}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Animated.View>
          </>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
