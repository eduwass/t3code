// T3 Space fork: Paper frames, full size, on a small canvas styled after Paper (board 09 in
// the T3 Space × Paper file). Renders the frame as HTML so text stays sharp when
// zoomed; the thread's screenshot stands in when Paper cannot render it live.
import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import { PAPER_FRAME_SIZE_MESSAGE, type EnvironmentId, type PaperFrame } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { observeResize } from "~/lib/observeResize";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import "./paperFrameViewer.css";
import { PaperRain } from "./PaperRain";
import { usePaperDrawingKey, usePaperLiveRevision, usePaperThumbnail } from "./paperThreadShots";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
// Room around the frame on the canvas, and for its label above it.
const CANVAS_PAD = 48;
const LABEL_SPACE = 24;
const ZOOM_PRESETS = [0.5, 1, 2] as const;
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const PAPER_ICON = "/paper-icon.png";

/** The live-frame query, shared by prefetch and the viewer so an opened frame is already loaded. */
export function usePaperLiveFrame(environmentId: EnvironmentId, shot: PaperShot, enabled: boolean) {
  const revision = usePaperLiveRevision(environmentId, shot);
  return useEnvironmentQuery(
    enabled
      ? serverEnvironment.paper({
          environmentId,
          input: {
            _tag: "liveFrame",
            fileId: shot.fileId,
            nodeId: shot.nodeId,
            revision,
          },
        })
      : null,
  );
}

/** "just now", "4 min ago", "2 h ago", "yesterday", "3 days ago". */
function capturedLabel(capturedAt: number | null, now: number): string | null {
  if (capturedAt === null) return null;
  const minutes = Math.floor(Math.max(0, now - capturedAt) / 60_000);
  if (minutes < 1) return "Captured just now";
  if (minutes < 60) return `Captured ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Captured ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Captured yesterday" : `Captured ${days} days ago`;
}

export function PaperFrameViewer(props: {
  readonly environmentId: EnvironmentId;
  /** The frames in the rail, in rail order. */
  readonly shots: ReadonlyArray<PaperShot>;
  readonly initialKey: string;
  readonly live: boolean;
  readonly onClose: () => void;
}) {
  const [currentKey, setCurrentKey] = useState(props.initialKey);
  const index = Math.max(
    0,
    props.shots.findIndex((shot) => shot.key === currentKey),
  );
  const shot = props.shots[index] ?? props.shots[0];
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawingKey = usePaperDrawingKey(props.environmentId);
  const [now] = useState(() => Date.now());

  const names = useEnvironmentQuery(
    serverEnvironment.paper({
      environmentId: props.environmentId,
      input: {
        _tag: "frameNames",
        frames: props.shots.slice(0, 64).map(({ fileId, nodeId }) => ({ fileId, nodeId })),
      },
    }),
  );
  const file = useEnvironmentQuery(
    shot === undefined
      ? null
      : serverEnvironment.paper({
          environmentId: props.environmentId,
          input: { _tag: "listFrames", fileId: shot.fileId },
        }),
  );
  const frameOf = (target: PaperShot): PaperFrame | null =>
    names.data?._tag === "frameNames"
      ? (names.data.frames.find(
          (frame) => frame.fileId === target.fileId && frame.nodeId === target.nodeId,
        ) ?? null)
      : null;
  const nameOf = (target: PaperShot) => frameOf(target)?.name ?? "Paper frame";
  const fileName = file.data?._tag === "listFrames" ? file.data.fileName : null;
  const go = (delta: number) => {
    const next = props.shots[index + delta];
    if (next !== undefined) setCurrentKey(next.key);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- arrow keys page through frames while the viewer is open
  useEffect(() => {
    // Capture phase: the dialog stops arrow keys before they bubble to the window.
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return;
      event.preventDefault();
      go(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (shot === undefined) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1"
        initialFocus={closeRef}
      >
        <DialogTitle className="sr-only">{nameOf(shot)}</DialogTitle>
        <div data-pfv="window">
          <div data-pfv="topbar">
            <div data-pfv="file">
              <img src={PAPER_ICON} alt="" aria-hidden width={22} height={22} />
              <span>{fileName ?? "Paper"}</span>
            </div>
            <div data-pfv="actions">
              <a data-pfv="open" href={shot.url} target="_blank" rel="noreferrer">
                <img src={PAPER_ICON} alt="" aria-hidden width={16} height={16} />
                Open in Paper
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M4 3h5v5M9 3L3.5 8.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close"
                data-pfv="close"
                onClick={props.onClose}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div data-pfv="body">
            <div data-pfv="rail">
              <div data-pfv="rail-head">
                <b>From this thread</b>
                <span>{props.shots.length}</span>
              </div>
              {props.shots.map((railShot) => (
                <RailRow
                  key={railShot.key}
                  environmentId={props.environmentId}
                  shot={railShot}
                  name={nameOf(railShot)}
                  detail={
                    railShot.key === drawingKey ? (
                      <span data-pfv="row-live">
                        <PaperRain />
                        Drawing now
                      </span>
                    ) : (
                      capturedLabel(railShot.capturedAt, now)
                    )
                  }
                  selected={railShot.key === shot.key}
                  onSelect={() => setCurrentKey(railShot.key)}
                />
              ))}
            </div>
            <ViewerCanvas
              key={shot.key}
              environmentId={props.environmentId}
              shot={shot}
              frame={frameOf(shot)}
              name={nameOf(shot)}
              live={props.live}
              drawing={shot.key === drawingKey}
              index={index}
              count={props.shots.length}
              onStep={go}
            />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function RailRow(props: {
  readonly environmentId: EnvironmentId;
  readonly shot: PaperShot;
  readonly name: string;
  readonly detail: ReactNode;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const image = useAssetUrlState(
    props.environmentId,
    usePaperThumbnail(props.environmentId, props.shot),
  );
  return (
    <button
      type="button"
      data-pfv="row"
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onSelect}
    >
      <div data-pfv="thumb">
        {image._tag === "Success" ? <img src={image.url} alt="" draggable={false} /> : null}
      </div>
      <div data-pfv="row-text">
        <span data-pfv="row-name">{props.name}</span>
        {props.detail !== null ? <span data-pfv="row-detail">{props.detail}</span> : null}
      </div>
    </button>
  );
}

function ViewerCanvas(props: {
  readonly environmentId: EnvironmentId;
  readonly shot: PaperShot;
  readonly frame: PaperFrame | null;
  readonly name: string;
  readonly live: boolean;
  readonly drawing: boolean;
  readonly index: number;
  readonly count: number;
  readonly onStep: (delta: number) => void;
}) {
  const live = usePaperLiveFrame(props.environmentId, props.shot, props.live);
  const liveData = live.data?._tag === "liveFrame" ? live.data : null;
  // Paper has no size for content-sized frames, so each frame reports the size it renders at.
  // A newer drawing loads hidden beside the shown one and replaces it once it has reported.
  const [shown, setShown] = useState<{
    src: string;
    width: number;
    height: number;
    /** The drawing it replaced, left underneath until the new one has drawn. */
    under: string | null;
  } | null>(null);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const frameUrl = useAssetUrlState(
    props.environmentId,
    liveData === null
      ? null
      : {
          _tag: "attachment",
          attachmentId: liveData.attachmentId,
          mimeType: "text/html",
          disposition: "inline",
        },
  );
  const src = frameUrl._tag === "Success" ? frameUrl.url : null;
  // With live frames on, the frame opens empty at its real size and the live frame draws
  // into it; the screenshot is only the fallback when Paper cannot render it live.
  const liveFailed = shown === null && liveData === null && (live.error !== null || !props.live);
  const metaSize =
    props.frame?.width && props.frame.height
      ? { width: props.frame.width, height: props.frame.height }
      : null;
  const liveSize =
    liveData?.width && liveData.height ? { width: liveData.width, height: liveData.height } : null;
  const shotWidth = metaSize?.width ?? 1440;
  const size =
    shown ??
    metaSize ??
    liveSize ??
    (liveFailed && imageAspect !== null
      ? { width: shotWidth, height: shotWidth * imageAspect }
      : null);
  const frameSrcs = [shown?.under, shown?.src, src].filter(
    (value, i, all): value is string => value != null && all.indexOf(value) === i,
  );
  const width = size?.width ?? 1440;
  const height = size?.height ?? 900;

  // Pan and zoom are one transform on the stage, set outside React: a trackpad sends a
  // wheel event per frame, and re-rendering or re-laying out the frame for each one stutters.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const view = useRef({ x: 0, y: 0, scale: 1, fitted: true });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const zoomTextRef = useRef<HTMLSpanElement | null>(null);
  // In a ref: pressing re-renders the dialog, which re-attaches the listeners mid-drag.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);

  const fitView = () => {
    const bw = box?.width ?? 960;
    const bh = box?.height ?? 640;
    const aw = Math.max(120, bw - CANVAS_PAD * 2);
    const ah = Math.max(120, bh - CANVAS_PAD * 2 - LABEL_SPACE);
    // Like Paper's zoom to fit, never upscaling; long pages fit their width and pan.
    const scale = Math.min(1, aw / width, height / width > 2 ? Infinity : ah / height);
    const shown = height * scale;
    const y = shown > ah ? CANVAS_PAD + LABEL_SPACE : (bh - shown + LABEL_SPACE) / 2;
    return { x: (bw - width * scale) / 2, y, scale, fitted: true };
  };
  const apply = (next: { x: number; y: number; scale: number; fitted: boolean }) => {
    const bw = box?.width ?? 960;
    const bh = box?.height ?? 640;
    // Keep part of the frame on the canvas so it cannot be lost.
    const keep = 64;
    const x = Math.min(bw - keep, Math.max(keep - width * next.scale, next.x));
    const y = Math.min(bh - keep, Math.max(keep - height * next.scale, next.y));
    view.current = { ...next, x, y };
    const stage = stageRef.current;
    const label = labelRef.current;
    if (stage !== null) stage.style.transform = `translate(${x}px, ${y}px) scale(${next.scale})`;
    if (label !== null) {
      label.style.transform = `translate(${x}px, ${y - LABEL_SPACE}px)`;
      label.style.width = `${width * next.scale}px`;
    }
    if (zoomTextRef.current !== null) {
      const percent = `${Math.round(next.scale * 100)}%`;
      zoomTextRef.current.textContent = next.fitted ? `Fit · ${percent}` : percent;
    }
  };
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const current = view.current;
    const scale = clampZoom(current.scale * factor);
    const px = rect === undefined ? 0 : (clientX ?? rect.left + rect.width / 2) - rect.left;
    const py = rect === undefined ? 0 : (clientY ?? rect.top + rect.height / 2) - rect.top;
    const k = scale / current.scale;
    apply({ x: px - (px - current.x) * k, y: py - (py - current.y) * k, scale, fitted: false });
  };
  const zoomTo = (target: number | "fit") =>
    target === "fit" ? apply(fitView()) : zoomAt(clampZoom(target) / view.current.scale);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions the stage in the DOM; refits while the user has not moved it
  useLayoutEffect(() => {
    apply(view.current.fitted ? fitView() : view.current);
  });

  const observeViewport = (viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport;
    if (viewport === null) return;
    setBox({ width: viewport.clientWidth, height: viewport.clientHeight });
    const stopResize = observeResize(viewport, ([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    // Scrolling pans, a pinch (ctrlKey) or cmd/ctrl+wheel zooms. React's wheel listener is
    // passive and cannot stop the page zooming or swiping back instead.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const sideways = event.shiftKey && event.deltaX === 0;
      const current = view.current;
      apply({
        ...current,
        x: current.x - (sideways ? event.deltaY : event.deltaX) * unit,
        y: current.y - (sideways ? 0 : event.deltaY) * unit,
        fitted: false,
      });
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      viewport.setPointerCapture(event.pointerId);
      viewport.style.cursor = "grabbing";
    };
    const move = (event: PointerEvent) => {
      const from = drag.current;
      if (from?.id !== event.pointerId) return;
      const current = view.current;
      apply({
        ...current,
        x: current.x + event.clientX - from.x,
        y: current.y + event.clientY - from.y,
        fitted: false,
      });
      drag.current = { ...from, x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      viewport.style.cursor = "";
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
    return () => {
      stopResize();
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", up);
    };
  };

  const observeFrame = (frameSrc: string) => (iframe: HTMLIFrameElement | null) => {
    if (iframe === null) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; width?: unknown; height?: unknown } | null;
      if (event.source !== iframe.contentWindow || data?.type !== PAPER_FRAME_SIZE_MESSAGE) return;
      if (typeof data.width === "number" && typeof data.height === "number" && data.width > 0) {
        const size = { width: data.width, height: data.height };
        setShown((prev) =>
          prev?.src === frameSrc
            ? { ...prev, ...size }
            : { src: frameSrc, ...size, under: prev?.src ?? null },
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  };

  const modifier = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <div data-pfv="canvas">
      <div ref={observeViewport} data-pfv="viewport">
        <div ref={labelRef} data-pfv="label" data-pending={size === null ? "" : undefined}>
          <span data-pfv="label-name">
            {props.drawing ? <PaperRain /> : null}
            {props.name}
          </span>
          {live.error !== null && shown !== null ? (
            // Deleted in Paper, or Paper unreachable: the last drawing stays up.
            <span>Couldn't update · showing the last version</span>
          ) : (
            <span>
              {Math.round(width)} × {Math.round(height)}
            </span>
          )}
        </div>
        <div
          ref={stageRef}
          data-pfv="frame"
          data-pending={size === null ? "" : undefined}
          data-blank={liveFailed ? undefined : ""}
          style={{ width, height }}
        >
          {liveFailed ? (
            <ScreenshotImage
              environmentId={props.environmentId}
              shot={props.shot}
              alt={props.name}
              onAspect={setImageAspect}
            />
          ) : null}
          {frameSrcs.map((frameSrc) => (
            <iframe
              key={frameSrc}
              ref={observeFrame(frameSrc)}
              src={frameSrc}
              title={props.name}
              // Scripts only for the size report T3 adds; no same-origin, so it stays isolated.
              sandbox="allow-scripts"
              data-hidden={shown?.src === frameSrc || shown?.under === frameSrc ? undefined : ""}
              style={{
                width: shown?.src === frameSrc ? shown.width : liveData?.width || 1440,
                height: shown?.src === frameSrc ? shown.height : liveData?.height || 900,
              }}
            />
          ))}
          {/* Keeps wheel, pinch and drag with the viewer; the iframe would swallow them. */}
          <div data-pfv="shield" />
        </div>
      </div>
      <div data-pfv="hint">
        <span>Pinch or {modifier} scroll to zoom</span>
        <i>·</i>
        <span>drag to pan</span>
        <i>·</i>
        <span>← → for frames</span>
      </div>
      <div data-pfv="toolbar">
        <ToolbarButton
          label="Previous frame"
          disabled={props.index === 0}
          onClick={() => props.onStep(-1)}
        >
          <path d="M8.5 3.5L5 7l3.5 3.5" />
        </ToolbarButton>
        <div data-pfv="count">
          {props.index + 1} / {props.count}
        </div>
        <ToolbarButton
          label="Next frame"
          disabled={props.index >= props.count - 1}
          onClick={() => props.onStep(1)}
        >
          <path d="M5.5 3.5L9 7l-3.5 3.5" />
        </ToolbarButton>
        <div data-pfv="divider" />
        <ToolbarButton label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
          <path d="M3.5 7h7" />
        </ToolbarButton>
        <Menu>
          <MenuTrigger render={<button type="button" data-pfv="zoom" />}>
            <span ref={zoomTextRef} />
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path
                d="M2.5 4l2.5 2.5L7.5 4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </MenuTrigger>
          <MenuPopup side="top" align="center">
            <MenuItem onClick={() => zoomTo("fit")}>Zoom to fit</MenuItem>
            {ZOOM_PRESETS.map((preset) => (
              <MenuItem key={preset} onClick={() => zoomTo(preset)}>
                {preset * 100}%
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
        <ToolbarButton label="Zoom in" onClick={() => zoomAt(1.25)}>
          <path d="M3.5 7h7M7 3.5v7" />
        </ToolbarButton>
      </div>
    </div>
  );
}

function ScreenshotImage(props: {
  readonly environmentId: EnvironmentId;
  readonly shot: PaperShot;
  readonly alt: string;
  readonly onAspect: (aspect: number) => void;
}) {
  const image = useAssetUrlState(
    props.environmentId,
    usePaperThumbnail(props.environmentId, props.shot),
  );
  if (image._tag !== "Success") return <div data-pfv="placeholder" />;
  return (
    <img
      src={image.url}
      alt={props.alt}
      draggable={false}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0) props.onAspect(naturalHeight / naturalWidth);
      }}
    />
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      data-pfv="tool"
      onClick={props.onClick}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {props.children}
      </svg>
    </button>
  );
}
