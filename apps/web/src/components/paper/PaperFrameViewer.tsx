// T3 Space fork: a Paper frame, full size. Opens on the screenshot the thread
// already has, then swaps to the frame rendered as HTML once the server has it,
// so opening never waits and text stays sharp when zoomed.
import type { PaperShot } from "@t3tools/client-runtime/work-log/paper-tools";
import { PAPER_FRAME_SIZE_MESSAGE, type EnvironmentId } from "@t3tools/contracts";
import { ArrowUpRightIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { observeResize } from "~/lib/observeResize";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { ChatMarkdownAssetImage } from "../chat/ChatMarkdownMedia";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
// Same rule as the live frame, so swapping in the live frame does not jump.
const SCREENSHOT_STYLE = { width: "auto", height: "auto", maxWidth: "100%" } as const;
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

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

export function PaperFrameViewer(props: {
  readonly environmentId: EnvironmentId;
  readonly shot: PaperShot;
  readonly name: string | null;
  readonly live: boolean;
  readonly onClose: () => void;
}) {
  const live = usePaperLiveFrame(props.environmentId, props.shot, props.live);
  const liveData = live.data?._tag === "liveFrame" ? live.data : null;
  // Paper has no size for content-sized frames, so the frame reports the size it renders at.
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const frame = liveData === null || measured === null ? null : { ...liveData, ...measured };
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
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [zoomFactor, setZoomFactor] = useState(1);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Fit the width, never upscale; long pages and phone frames scroll down instead of shrinking.
  const fit = frame === null || box === null ? 1 : Math.min(1, (box.width - 32) / frame.width);
  const zoom = clampZoom(fit * zoomFactor);

  const observeViewport = (viewport: HTMLDivElement | null) => {
    if (viewport === null) return;
    setBox({ width: viewport.clientWidth, height: viewport.clientHeight });
    const stopResize = observeResize(viewport, ([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    // Pinch and ctrl/cmd+wheel zoom the frame; React's wheel listener is passive and cannot stop page zoom.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoomFactor((value) => value * Math.exp(-event.deltaY * 0.01));
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => {
      stopResize();
      viewport.removeEventListener("wheel", wheel);
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

  const status = !props.live
    ? "Screenshot"
    : frame !== null
      ? "Live frame"
      : live.error !== null
        ? `Screenshot · ${live.error}`
        : "Screenshot · loading live frame…";

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1"
        initialFocus={closeButtonRef}
      >
        <DialogTitle className="sr-only">{props.name ?? "Paper frame"}</DialogTitle>
        <div className="relative w-[92vw]">
          <Button
            ref={closeButtonRef}
            aria-label="Close"
            size="icon-xs"
            variant="media-close"
            className="absolute right-0 -top-10 z-20"
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
          <div
            ref={observeViewport}
            className="relative flex h-[min(86vh,calc(100vh-160px))] overflow-auto scrollbar-gutter-both overscroll-contain rounded-lg bg-background p-4 shadow-2xl ring-1 ring-border/70"
          >
            {src !== null ? (
              <div
                className={
                  frame === null ? "pointer-events-none absolute opacity-0" : "m-auto shrink-0"
                }
                style={frame === null ? undefined : { zoom }}
              >
                <iframe
                  ref={observeFrame}
                  src={src}
                  title={props.name ?? "Paper frame"}
                  // Scripts only for the size report T3 adds; no same-origin, so it stays isolated.
                  sandbox="allow-scripts"
                  className="block border-0"
                  style={{
                    width: measured?.width ?? (liveData?.width || 1440),
                    height: measured?.height ?? (liveData?.height || 900),
                  }}
                />
              </div>
            ) : null}
            {frame === null ? (
              <div className="m-auto">
                <ChatMarkdownAssetImage
                  environmentId={props.environmentId}
                  resource={props.shot.image}
                  alt={props.name ?? `Paper frame ${props.shot.nodeId}`}
                  style={SCREENSHOT_STYLE}
                />
              </div>
            ) : null}
          </div>
          <div className="mt-2 flex min-w-0 items-center justify-center gap-3 text-xs text-white/80">
            <span className="truncate">
              {props.name ?? props.shot.nodeId} · {status}
            </span>
            {frame !== null ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  aria-label="Zoom out"
                  size="icon-sm"
                  variant="overlay"
                  onClick={() => setZoomFactor((value) => value / 1.25)}
                >
                  <MinusIcon />
                </Button>
                <Button
                  aria-label="Fit"
                  size="sm"
                  variant="overlay"
                  onClick={() => setZoomFactor(1)}
                >
                  {Math.round(zoom * 100)}%
                </Button>
                <Button
                  aria-label="Zoom in"
                  size="icon-sm"
                  variant="overlay"
                  onClick={() => setZoomFactor((value) => value * 1.25)}
                >
                  <PlusIcon />
                </Button>
              </div>
            ) : null}
            <a
              href={props.shot.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 hover:text-white"
            >
              Open in Paper
              <ArrowUpRightIcon className="size-3" aria-hidden />
            </a>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
