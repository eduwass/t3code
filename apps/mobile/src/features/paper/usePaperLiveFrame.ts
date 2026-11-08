// T3 Space fork: a Paper frame's live HTML: the server renders it, then the phone keeps
// the page in memory. Prefetching calls this too, so opening a frame skips the network.
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { useAssetUrlState } from "../../state/assets";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

const MAX_FRAMES = 32;
const loaded = new Map<string, string>();
const loading = new Map<string, Promise<string>>();

const cachedPaperLiveHtml = (attachmentId: string) => loaded.get(attachmentId) ?? null;

/** Fetches a live frame's HTML once per drawing; concurrent callers share the request. */
function loadPaperLiveHtml(attachmentId: string, url: string): Promise<string> {
  const done = loaded.get(attachmentId);
  if (done !== undefined) return Promise.resolve(done);
  const pending = loading.get(attachmentId);
  if (pending !== undefined) return pending;
  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Paper frame HTML returned ${response.status}.`);
      const html = await response.text();
      loaded.set(attachmentId, html);
      // ponytail: oldest-first eviction; a frame is ~100 KB, so the cap holds a few MB.
      const oldest = loaded.keys().next();
      if (loaded.size > MAX_FRAMES && !oldest.done) loaded.delete(oldest.value);
      return html;
    })
    .finally(() => loading.delete(attachmentId));
  loading.set(attachmentId, request);
  return request;
}

export function usePaperLiveFrame(
  environmentId: EnvironmentId,
  frame: { readonly fileId: string; readonly nodeId: string } | null,
  revision: string | null,
) {
  const live = useEnvironmentQuery(
    frame === null
      ? null
      : serverEnvironment.paper({
          environmentId,
          input: {
            _tag: "liveFrame",
            fileId: frame.fileId,
            nodeId: frame.nodeId,
            ...(revision === null ? {} : { revision }),
          },
        }),
  );
  const data = live.data?._tag === "liveFrame" ? live.data : null;
  const asset = useAssetUrlState(
    environmentId,
    data === null
      ? null
      : {
          _tag: "attachment",
          attachmentId: data.attachmentId,
          mimeType: "text/html",
          disposition: "inline",
        },
  );
  const url = asset._tag === "Success" ? asset.url : null;
  const attachmentId = data?.attachmentId ?? null;
  const cached = attachmentId === null ? null : cachedPaperLiveHtml(attachmentId);
  const [fetched, setFetched] = useState<{ id: string; html: string | null } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- downloads the frame's HTML from the server
  useEffect(() => {
    if (attachmentId === null || url === null || cached !== null) return;
    let current = true;
    loadPaperLiveHtml(attachmentId, url).then(
      (html) => current && setFetched({ id: attachmentId, html }),
      () => current && setFetched({ id: attachmentId, html: null }),
    );
    return () => {
      current = false;
    };
  }, [attachmentId, url, cached]);
  const settled = fetched !== null && fetched.id === attachmentId ? fetched : null;
  return {
    error: live.error,
    data,
    url,
    html: cached ?? settled?.html ?? null,
    /** The download failed; the page view loads the URL itself instead. */
    htmlFailed: settled !== null && settled.html === null,
  };
}
