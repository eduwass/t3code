// T3 Space fork: a Paper frame rendered as HTML on the phone, so pinch zoom stays
// sharp. The page reports its size to its parent; a WebView has none, so the
// script below catches that report, fits the frame to the width and tells the app.
import { PAPER_FRAME_SIZE_MESSAGE, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useAssetUrlState } from "../../state/assets";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import type { PaperViewerFrame } from "./paperFrameViewerState";

// Laid out 1440px wide like the web viewer's iframe, so boards keep their shape. Once the
// frame reports its size, the page becomes the viewer's canvas: the frame fits the width
// less 16pt margins (never above 100%), centered between the viewer's bars. Native page
// zoom keeps pinch zoom sharp, and the page reports its scale for the zoom pill.
const bridgeScript = (insetTop: number, insetBottom: number) => `(function(){
var post=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
var meta=document.createElement("meta");meta.name="viewport";meta.content="width=1440";
document.addEventListener("DOMContentLoaded",function(){document.head.appendChild(meta);document.documentElement.style.webkitTextSizeAdjust="100%";document.documentElement.style.background=${JSON.stringify(PAPER_CANVAS)};document.documentElement.style.touchAction="manipulation"});
addEventListener("message",function(e){var d=e.data;if(!d||d.type!==${JSON.stringify(PAPER_FRAME_SIZE_MESSAGE)}||!(d.width>0))return;
var W=screen.width,shown=Math.min(W-32,d.width),vw=W*d.width/shown,s=W/vw;
var root=document.body.firstElementChild;if(root){root.style.width=d.width+"px";root.style.flexShrink="0"}
var b=document.body.style;b.margin="0";b.background=${JSON.stringify(PAPER_CANVAS)};b.display="flex";b.alignItems="center";b.justifyContent="center";b.boxSizing="border-box";b.minHeight="100vh";b.paddingTop=(${insetTop}/s)+"px";b.paddingBottom=(${insetBottom}/s)+"px";
meta.content="width="+vw+",minimum-scale="+s+",maximum-scale="+Math.max(4,s*8);
post({type:"ready",width:d.width,height:d.height,scale:s});
setTimeout(function(){if(window.visualViewport)base=visualViewport.scale},300)});
var sx=0,sy=0;addEventListener("touchstart",function(e){if(e.touches.length===1){sx=e.touches[0].clientX;sy=e.touches[0].clientY}},{passive:true});
addEventListener("touchend",function(e){var t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(!zoomed&&e.touches.length===0&&Math.abs(dx)*screen.width/innerWidth>60&&Math.abs(dx)>2*Math.abs(dy))post({type:"swipe",direction:dx<0?1:-1})},{passive:true});
var zoomed=false,base=0,last=0,lastTap=0;
addEventListener("touchend",function(e){var t=e.changedTouches[0];if(e.touches.length!==0||!t||Math.abs(t.clientX-sx)>10||Math.abs(t.clientY-sy)>10)return;var now=Date.now();if(now-lastTap<350){e.preventDefault();lastTap=0;if(zoomed)post({type:"fit"})}else lastTap=now},{passive:false});
if(window.visualViewport)visualViewport.addEventListener("resize",function(){if(!base)return;var v=visualViewport.scale;if(Math.abs(v-last)<last*0.01)return;last=v;zoomed=v>base*1.01;post({type:"zoom",zoomed:zoomed,scale:v})});
})();true;`;

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
  /** Zoomed past fit, and the scale relative to the frame's real size. */
  readonly onZoomChange: (zoomed: boolean, scale: number) => void;
  /** A double-tap while zoomed; WebKit cannot be zoomed back from script, so the app reloads the frame. */
  readonly onFit: () => void;
  /** The WebView keeps touches, so it reports sideways swipes for the pager. */
  readonly onSwipe: (direction: 1 | -1) => void;
  readonly visible: boolean;
}) {
  const live = useEnvironmentQuery(
    serverEnvironment.paper({
      environmentId: props.environmentId,
      input: {
        _tag: "liveFrame",
        fileId: props.frame.fileId,
        nodeId: props.frame.nodeId,
        ...(props.frame.revision === null ? {} : { revision: props.frame.revision }),
      },
    }),
  );
  const asset = useAssetUrlState(
    props.environmentId,
    live.data?._tag === "liveFrame"
      ? {
          _tag: "attachment",
          attachmentId: live.data.attachmentId,
          mimeType: "text/html",
          disposition: "inline",
        }
      : null,
  );
  // Signed URLs are re-minted periodically; following them would reload the frame.
  const [uri, setUri] = useState<string | null>(null);
  if (uri === null && asset._tag === "Success") setUri(asset.url);
  if (uri === null) return null;
  const onMessage = (event: WebViewMessageEvent) => {
    const message = readBridgeMessage(event.nativeEvent.data);
    if (message?.type === "ready") {
      const width = num(message.width);
      const height = num(message.height);
      const scale = num(message.scale);
      if (width !== null && height !== null && scale !== null)
        props.onReady({ width, height, scale });
    }
    if (message?.type === "zoom") {
      props.onZoomChange(message.zoomed === true, num(message.scale) ?? 1);
    }
    if (message?.type === "fit") props.onFit();
    if (message?.type === "swipe") props.onSwipe(message.direction === -1 ? -1 : 1);
  };
  return (
    <WebView<object>
      source={{ uri }}
      // The WebView wraps itself in a container; that container is what has to fill the page.
      containerStyle={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: props.visible ? 1 : 0,
      }}
      style={{ backgroundColor: PAPER_CANVAS }}
      injectedJavaScriptBeforeContentLoaded={bridgeScript(props.insetTop, props.insetBottom)}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(request) => request.url === uri}
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      overScrollMode="never"
      showsHorizontalScrollIndicator={false}
    />
  );
}
