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
// frame reports its size, the viewport takes that width and WebKit fits it to the screen;
// frames narrower than the phone stay at 100%. Native page zoom keeps pinch zoom sharp.
const BRIDGE_SCRIPT = `(function(){
var post=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
var meta=document.createElement("meta");meta.name="viewport";meta.content="width=1440";
document.addEventListener("DOMContentLoaded",function(){document.head.appendChild(meta);document.documentElement.style.webkitTextSizeAdjust="100%"});
addEventListener("message",function(e){var d=e.data;if(!d||d.type!==${JSON.stringify(PAPER_FRAME_SIZE_MESSAGE)}||!(d.width>0))return;
var root=document.body.firstElementChild;if(root){root.style.width=d.width+"px";root.style.margin="0 auto"}
meta.content=d.width>screen.width?"width="+d.width+",maximum-scale=6":"width=device-width,initial-scale=1,maximum-scale=6";
post({type:"ready"});
setTimeout(function(){if(window.visualViewport)base=visualViewport.scale},300)});
var sx=0,sy=0;addEventListener("touchstart",function(e){if(e.touches.length===1){sx=e.touches[0].clientX;sy=e.touches[0].clientY}},{passive:true});
addEventListener("touchend",function(e){var t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(!zoomed&&e.touches.length===0&&Math.abs(dx)*screen.width/innerWidth>60&&Math.abs(dx)>2*Math.abs(dy))post({type:"swipe",direction:dx<0?1:-1})},{passive:true});
var zoomed=false,base=0;if(window.visualViewport)visualViewport.addEventListener("resize",function(){if(!base)return;var z=visualViewport.scale>base*1.01;if(z!==zoomed){zoomed=z;post({type:"zoom",zoomed:z})}});
})();true;`;

/** Only the bridge script posts here; anything that is not its JSON is ignored. */
function readBridgeMessage(
  data: string,
): { type?: unknown; zoomed?: unknown; direction?: unknown } | null {
  try {
    return JSON.parse(data) as { type?: unknown; zoomed?: unknown; direction?: unknown };
  } catch {
    return null;
  }
}

export function PaperLiveFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly frame: PaperViewerFrame;
  readonly onReady: () => void;
  readonly onZoomedChange: (zoomed: boolean) => void;
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
    if (message?.type === "ready") props.onReady();
    if (message?.type === "zoom") props.onZoomedChange(message.zoomed === true);
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
      style={{ backgroundColor: "transparent" }}
      injectedJavaScriptBeforeContentLoaded={BRIDGE_SCRIPT}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(request) => request.url === uri}
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      overScrollMode="never"
      showsHorizontalScrollIndicator={false}
    />
  );
}
