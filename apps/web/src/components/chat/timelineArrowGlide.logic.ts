/**
 * Held-arrow speed. Chromium scrolls a held arrow at about 40px per 16ms frame at full
 * speed (~2400px/s); 1500px/s stays readable on a 60 fps TV stream and still feels like it.
 */
export const TIMELINE_ARROW_GLIDE_PX_PER_SECOND = 1500;
// A stalled frame catches up at most this much, so a hitch does not become a jump.
const MAX_FRAME_MS = 50;
// Repeats stop arriving when a keyup is lost (focus left the window mid-hold); stop then too.
const REPEAT_TIMEOUT_MS = 300;

type GlideView = Pick<
  Window,
  "requestAnimationFrame" | "cancelAnimationFrame" | "addEventListener" | "removeEventListener"
>;

let activeGlide: { readonly key: string } | null = null;

/**
 * Glides `node` at a steady velocity while `key` stays held, one scrollTop step per frame,
 * whatever the OS repeat rate. Any keyup, any other keydown, a pointer press or the window
 * losing focus stops it. Returns false when a glide for this key is already running, so the
 * caller swallows the repeat.
 */
export function glideTimelineWhileHeld(
  node: Pick<HTMLElement, "scrollTop">,
  view: GlideView,
  key: string,
  direction: 1 | -1,
  now: number,
): boolean {
  if (activeGlide?.key === key) return false;
  const glide = { key };
  activeGlide = glide;
  let lastFrame: number | null = null;
  let lastRepeat = now;
  let frame = 0;
  const stop = () => {
    view.cancelAnimationFrame(frame);
    view.removeEventListener("keydown", onKeyDown, true);
    view.removeEventListener("keyup", stop, true);
    view.removeEventListener("pointerdown", stop, true);
    view.removeEventListener("blur", stop);
    if (activeGlide === glide) activeGlide = null;
  };
  const onKeyDown = (event: Event) => {
    const { key: pressed, repeat, timeStamp } = event as KeyboardEvent;
    if (pressed === key && repeat) lastRepeat = timeStamp;
    else stop();
  };
  const step = (time: number) => {
    if (activeGlide !== glide || time - lastRepeat > REPEAT_TIMEOUT_MS) return stop();
    if (lastFrame !== null) {
      const elapsed = Math.min(time - lastFrame, MAX_FRAME_MS);
      node.scrollTop += (direction * TIMELINE_ARROW_GLIDE_PX_PER_SECOND * elapsed) / 1000;
    }
    lastFrame = time;
    frame = view.requestAnimationFrame(step);
  };
  view.addEventListener("keydown", onKeyDown, true);
  view.addEventListener("keyup", stop, true);
  view.addEventListener("pointerdown", stop, true);
  view.addEventListener("blur", stop);
  frame = view.requestAnimationFrame(step);
  return true;
}
