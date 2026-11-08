// T3 Space fork: a Paper frame rendered as HTML on the phone, so pinch zoom stays
// sharp. The page reports its size to its parent; a WebView has none, so the
// script below catches that report, fits the frame to the width and tells the app.
import { PAPER_FRAME_SIZE_MESSAGE, type EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { PaperViewerFrame } from "./paperFrameViewerState";
import { usePaperLiveFrame } from "./usePaperLiveFrame";

// The frame fits the width less 16pt margins (never above 100%), centered between the
// viewer's bars; native page zoom keeps pinch sharp. With the width known up front the page
// lays out fitted from the start, so "ready" follows its first paint. Otherwise it is laid
// out 1440px wide, refitted on the size report, and "ready" waits for WebKit to apply that.
const bridgeScript = (insetTop: number, insetBottom: number, width: number) => `(function(){
var post=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
var meta=document.createElement("meta");meta.name="viewport";meta.content="width=1440";
var fitted=0,fs=1;
function fit(w){var W=screen.width,shown=Math.min(W-32,w),vw=W*w/shown,s=W/vw;
var root=document.body.firstElementChild;if(root){root.style.width=w+"px";root.style.flexShrink="0"}
var b=document.body.style;b.margin="0";b.background=${JSON.stringify(PAPER_CANVAS)};b.display="flex";b.alignItems="center";b.justifyContent="center";b.boxSizing="border-box";b.minHeight="100vh";b.paddingTop=(${insetTop}/s)+"px";b.paddingBottom=(${insetBottom}/s)+"px";
meta.content="width="+vw+",minimum-scale="+s+",maximum-scale="+Math.max(4,s*8);fitted=w;fs=s}
document.addEventListener("DOMContentLoaded",function(){if(${width}>0)fit(${width});document.head.appendChild(meta);document.documentElement.style.webkitTextSizeAdjust="100%";document.documentElement.style.background=${JSON.stringify(PAPER_CANVAS)};document.documentElement.style.touchAction="manipulation"});
addEventListener("message",function(e){var d=e.data;if(!d||d.type!==${JSON.stringify(PAPER_FRAME_SIZE_MESSAGE)}||!(d.width>0))return;
var same=fitted===d.width;if(!same)fit(d.width);
var report=function(){post({type:"ready",width:d.width,height:d.height,scale:fs})};
setTimeout(function(){if(window.visualViewport)base=visualViewport.scale;if(!same)report()},300);
if(same)requestAnimationFrame(function(){requestAnimationFrame(report)})});
var sx=0,sy=0;addEventListener("touchstart",function(e){if(e.touches.length===1){sx=e.touches[0].clientX;sy=e.touches[0].clientY}},{passive:true});
addEventListener("touchend",function(e){var t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(!zoomed&&e.touches.length===0&&Math.abs(dx)*screen.width/innerWidth>60&&Math.abs(dx)>2*Math.abs(dy))post({type:"swipe",direction:dx<0?1:-1})},{passive:true});
var zoomed=false,base=0,last=0,lastTap=0;
addEventListener("touchend",function(e){var t=e.changedTouches[0];if(e.touches.length!==0||!t||Math.abs(t.clientX-sx)>10||Math.abs(t.clientY-sy)>10)return;var now=Date.now();if(now-lastTap<350){e.preventDefault();lastTap=0;if(zoomed)post({type:"fit"})}else lastTap=now},{passive:false});
if(window.visualViewport)visualViewport.addEventListener("resize",function(){if(!base)return;var v=visualViewport.scale;if(Math.abs(v-last)<last*0.01)return;last=v;zoomed=v>base*1.01;post({type:"zoom",zoomed:zoomed,scale:v})});
})();true;`;

// A newer drawing swaps into the open page instead of reloading it, so pinch zoom and scroll
// stay put; the frame's top-left is pinned, so it grows down and right like on desktop.
const swapScript = (html: string) => `(function(html){
var doc=new DOMParser().parseFromString(html,"text/html");
var next=doc.body.firstElementChild,old=document.body.firstElementChild;if(!next||!old)return;
document.head.querySelectorAll("style").forEach(function(n){n.remove()});
doc.head.querySelectorAll("style,link[rel=stylesheet]").forEach(function(n){
if(n.tagName==="LINK"&&document.head.querySelector('link[href="'+n.getAttribute("href")+'"]'))return;
document.head.appendChild(document.importNode(n,true))});
var before=old.getBoundingClientRect();next=document.importNode(next,true);next.style.flexShrink="0";old.replaceWith(next);
var after=next.getBoundingClientRect();window.scrollBy(after.left-before.left,after.top-before.top);
window.ReactNativeWebView.postMessage(JSON.stringify({type:"resized",width:Math.ceil(after.width),height:Math.ceil(after.height)}))
})(${JSON.stringify(html)});true;`;

interface BridgeMessage {
  readonly type?: unknown;
  readonly zoomed?: unknown;
  readonly direction?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly scale?: unknown;
}

const PAPER_CANVAS = "#181818";
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Only the bridge script posts here; anything that is not its JSON is ignored. */
function readBridgeMessage(data: string): BridgeMessage | null {
  try {
    return JSON.parse(data) as BridgeMessage;
  } catch {
    return null;
  }
}

export function PaperLiveFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly frame: PaperViewerFrame;
  /** Space the viewer's bars take at the top and bottom, in points. */
  readonly insetTop: number;
  readonly insetBottom: number;
  /** The frame's size and the page scale it fits at. */
  readonly onReady: (size: { width: number; height: number; scale: number }) => void;
  /** A newer drawing swapped in and changed the frame's size. */
  readonly onResize: (size: { width: number; height: number }) => void;
  /** Zoomed past fit, and the scale relative to the frame's real size. */
  readonly onZoomChange: (zoomed: boolean, scale: number) => void;
  /** A double-tap while zoomed; WebKit cannot be zoomed back from script, so the app reloads the frame. */
  readonly onFit: () => void;
  /** The WebView keeps touches, so it reports sideways swipes for the pager. */
  readonly onSwipe: (direction: 1 | -1) => void;
  readonly visible: boolean;
}) {
  const live = usePaperLiveFrame(props.environmentId, props.frame, props.frame.revision);
  const attachmentId = live.data?.attachmentId ?? null;
  // The page loads from the prefetched HTML, or from its URL if that download failed.
  // Fixed once loaded: re-minted URLs or a newer drawing must not reload the frame.
  const [source, setSource] = useState<{ html: string } | { uri: string } | null>(null);
  // The drawing the page first loaded; later ones are swapped in.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  if (source === null && attachmentId !== null) {
    const next =
      live.html !== null
        ? { html: live.html }
        : live.htmlFailed && live.url !== null
          ? { uri: live.url }
          : null;
    if (next !== null) {
      setSource(next);
      setLoadedId(attachmentId);
      setWidth(live.data?.width ?? 0);
    }
  }
  const webView = useRef<WebView<object>>(null);
  const swappedId = useRef<string | null>(null);
  const latestHtml = live.html;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes a newer drawing into the WebView's page
  useEffect(() => {
    if (!ready || attachmentId === null || latestHtml === null) return;
    if (attachmentId === (swappedId.current ?? loadedId)) return;
    swappedId.current = attachmentId;
    webView.current?.injectJavaScript(swapScript(latestHtml));
  }, [ready, attachmentId, latestHtml, loadedId]);
  if (source === null) return null;
  const onMessage = (event: WebViewMessageEvent) => {
    const message = readBridgeMessage(event.nativeEvent.data);
    if (message?.type === "ready") {
      const width = num(message.width);
      const height = num(message.height);
      const scale = num(message.scale);
      if (width !== null && height !== null && scale !== null) {
        setReady(true);
        props.onReady({ width, height, scale });
      }
    }
    if (message?.type === "resized") {
      const width = num(message.width);
      const height = num(message.height);
      if (width !== null && height !== null) props.onResize({ width, height });
    }
    if (message?.type === "zoom") {
      props.onZoomChange(message.zoomed === true, num(message.scale) ?? 1);
    }
    if (message?.type === "fit") props.onFit();
    if (message?.type === "swipe") props.onSwipe(message.direction === -1 ? -1 : 1);
  };
  return (
    <View
      pointerEvents={props.visible ? "auto" : "none"}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: props.visible ? 1 : 0,
      }}
    >
      <WebView<object>
        ref={webView}
        source={source}
        style={{ backgroundColor: PAPER_CANVAS }}
        injectedJavaScriptBeforeContentLoaded={bridgeScript(
          props.insetTop,
          props.insetBottom,
          width,
        )}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={(request) =>
          "uri" in source ? request.url === source.uri : request.url === "about:blank"
        }
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}
