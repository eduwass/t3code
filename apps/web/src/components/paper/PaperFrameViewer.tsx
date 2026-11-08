// T3 Space fork: Paper frames, full size, on a small canvas styled after Paper (board 09 in
// the T3 Space × Paper file). Opens on the screenshot the thread already has, then swaps to
// the frame rendered as HTML once the server has it, so text stays sharp when zoomed.
import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import {
  PAPER_FRAME_SIZE_MESSAGE,
  type EnvironmentId,
  type PaperConnectionStatus,
  type PaperFrame,
} from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { observeResize } from "~/lib/observeResize";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import "./paperFrameViewer.css";

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
  return useEnvironmentQuery(
    enabled
      ? serverEnvironment.paper({
          environmentId,
          input: {
            _tag: "liveFrame",
            fileId: shot.fileId,
            nodeId: shot.nodeId,
            revision: shot.image.itemId,
          },
        })
      : null,
  );
}

/** "just now", "4 min ago", "2 h ago", "yesterday", "3 days ago". */
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

const connectionLabel = (connections: ReadonlyArray<PaperConnectionStatus> | undefined) => {
  const inUse = connections?.find((connection) => connection.state === "in-use");
  return inUse === undefined ? null : inUse.kind === "desktop" ? "Desktop" : "Account";
};

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
  const connections = useEnvironmentQuery(
    props.live
      ? serverEnvironment.paper({
          environmentId: props.environmentId,
          input: { _tag: "connections" },
        })
      : null,
  );
  const frameOf = (target: PaperShot): PaperFrame | null =>
    names.data?._tag === "frameNames"
      ? (names.data.frames.find(
          (frame) => frame.fileId === target.fileId && frame.nodeId === target.nodeId,
        ) ?? null)
      : null;
  const nameOf = (target: PaperShot) => frameOf(target)?.name ?? "Paper frame";
  const fileName = file.data?._tag === "listFrames" ? file.data.fileName : null;
  const via =
    connections.data?._tag === "connections" ? connectionLabel(connections.data.connections) : null;
  const go = (delta: number) => {
    const next = props.shots[index + delta];
    if (next !== undefined) setCurrentKey(next.key);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- arrow keys page through frames while the viewer is open
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
              <ViewerStatus
                environmentId={props.environmentId}
                shot={shot}
                live={props.live}
                via={via}
              />
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
                  detail={capturedLabel(railShot.capturedAt, now)}
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

function ViewerStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly shot: PaperShot;
  readonly live: boolean;
  readonly via: string | null;
}) {
  const live = usePaperLiveFrame(props.environmentId, props.shot, props.live);
  const ready = live.data?._tag === "liveFrame";
  const label = !props.live
    ? "Screenshot"
    : ready
      ? props.via === null
        ? "Live"
        : `Live · ${props.via}`
      : live.error !== null
        ? "Screenshot · live frame unavailable"
        : "Loading live frame…";
  return (
    <div data-pfv="status">
      <div data-pfv="dot" data-live={ready ? "" : undefined} />
      {label}
    </div>
  );
}

function RailRow(props: {
  readonly environmentId: EnvironmentId;
  readonly shot: PaperShot;
  readonly name: string;
  readonly detail: string | null;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const image = useAssetUrlState(props.environmentId, props.shot.image);
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
  readonly index: number;
  readonly count: number;
  readonly onStep: (delta: number) => void;
}) {
  const live = usePaperLiveFrame(props.environmentId, props.shot, props.live);
  const liveData = live.data?._tag === "liveFrame" ? live.data : null;
  // Paper has no size for content-sized frames, so the frame reports the size it renders at.
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
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
  const showLive = liveData !== null && measured !== null;
  const known =
    props.frame?.width && props.frame.height
      ? { width: props.frame.width, height: props.frame.height }
      : null;
  const size = measured ?? known;

  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [zoomFactor, setZoomFactor] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The content point under the cursor when a zoom started, kept under the cursor after it.
  const zoomAnchor = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const availableWidth = box === null ? 960 : Math.max(120, box.width - CANVAS_PAD * 2);
  const availableHeight =
    box === null ? 640 : Math.max(120, box.height - CANVAS_PAD * 2 - LABEL_SPACE);
  // Fit like Paper's zoom to fit, never upscaling; long pages fit their width and scroll.
  const fit =
    size === null
      ? 1
      : Math.min(
          1,
          availableWidth / size.width,
          size.height / size.width > 2 ? Infinity : availableHeight / size.height,
        );
  const zoom = clampZoom(fit * zoomFactor);
  const baseWidth = size?.width ?? availableWidth;

  const zoomBy = (factor: number, at?: { clientX: number; clientY: number }) => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport !== null && content !== null) {
      const view = viewport.getBoundingClientRect();
      const rect = content.getBoundingClientRect();
      const x = at?.clientX ?? view.left + view.width / 2;
      const y = at?.clientY ?? view.top + view.height / 2;
      zoomAnchor.current = {
        x,
        y,
        fx: (x - rect.left) / rect.width,
        fy: (y - rect.top) / rect.height,
      };
    }
    setZoomFactor((value) => clampZoom(fit * value * factor) / fit);
  };
  const zoomTo = (target: number | "fit") =>
    zoomBy((target === "fit" ? fit : clampZoom(target)) / zoom);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the DOM so the zoom stays anchored at the cursor
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    zoomAnchor.current = null;
    if (anchor === null || viewport === null || content === null) return;
    const rect = content.getBoundingClientRect();
    viewport.scrollLeft += rect.left + anchor.fx * rect.width - anchor.x;
    viewport.scrollTop += rect.top + anchor.fy * rect.height - anchor.y;
  });

  const observeViewport = (viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport;
    if (viewport === null) return;
    setBox({ width: viewport.clientWidth, height: viewport.clientHeight });
    const stopResize = observeResize(viewport, ([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    // Scrolling pans natively; a pinch (ctrlKey) or cmd/ctrl+wheel zooms. React's wheel
    // listener is passive and cannot stop the page zooming instead.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.01), event);
    };
    let drag: { x: number; y: number; id: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      viewport.setPointerCapture(event.pointerId);
      viewport.style.cursor = "grabbing";
    };
    const move = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      viewport.scrollLeft -= event.clientX - drag.x;
      viewport.scrollTop -= event.clientY - drag.y;
      drag = { ...drag, x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
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

  const observeFrame = (iframe: HTMLIFrameElement | null) => {
    if (iframe === null) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; width?: unknown; height?: unknown } | null;
      if (event.source !== iframe.contentWindow || data?.type !== PAPER_FRAME_SIZE_MESSAGE) return;
      if (typeof data.width === "number" && typeof data.height === "number" && data.width > 0) {
        setMeasured({ width: data.width, height: data.height });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  };

  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const modifier = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <div data-pfv="canvas">
      <div ref={observeViewport} data-pfv="viewport">
        <div data-pfv="artboard">
          <div data-pfv="label" style={{ width: baseWidth * zoom }}>
            <span>{props.name}</span>
            {size !== null ? (
              <span>
                {Math.round(size.width)} × {Math.round(size.height)}
              </span>
            ) : null}
          </div>
          <div ref={contentRef} data-pfv="frame" style={{ zoom }}>
            {src !== null ? (
              <iframe
                ref={observeFrame}
                src={src}
                title={props.name}
                // Scripts only for the size report T3 adds; no same-origin, so it stays isolated.
                sandbox="allow-scripts"
                data-hidden={showLive ? undefined : ""}
                style={{
                  width: measured?.width ?? (liveData?.width || 1440),
                  height: measured?.height ?? (liveData?.height || 900),
                }}
              />
            ) : null}
            {!showLive ? (
              <ScreenshotImage
                environmentId={props.environmentId}
                shot={props.shot}
                alt={props.name}
                width={baseWidth}
                height={size?.height ?? null}
              />
            ) : null}
            {/* Keeps wheel, pinch and drag with the viewer; the iframe would swallow them. */}
            <div data-pfv="shield" />
          </div>
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
        <ToolbarButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          <path d="M3.5 7h7" />
        </ToolbarButton>
        <Menu>
          <MenuTrigger render={<button type="button" data-pfv="zoom" />}>
            {zoomFactor === 1 ? `Fit · ${zoomLabel}` : zoomLabel}
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
        <ToolbarButton label="Zoom in" onClick={() => zoomBy(1.25)}>
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
  readonly width: number;
  readonly height: number | null;
}) {
  const image = useAssetUrlState(props.environmentId, props.shot.image);
  const height = props.height ?? "auto";
  if (image._tag !== "Success") {
    return (
      <div
        data-pfv="placeholder"
        style={{ width: props.width, height: props.height ?? props.width * 0.62 }}
      />
    );
  }
  return (
    <img src={image.url} alt={props.alt} draggable={false} style={{ width: props.width, height }} />
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
