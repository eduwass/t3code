import { describe, expect, it } from "vite-plus/test";
import {
  TIMELINE_ARROW_GLIDE_PX_PER_SECOND,
  glideTimelineWhileHeld,
} from "./timelineArrowGlide.logic";

function setup() {
  const target = new EventTarget();
  let queued: FrameRequestCallback | null = null;
  const view = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      queued = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      queued = null;
    },
  };
  const node = { scrollTop: 1000 };
  const frame = (time: number) => {
    const callback = queued;
    queued = null;
    callback?.(time);
  };
  const key = (type: string, init: { key: string; repeat?: boolean; timeStamp?: number }) => {
    const event = new Event(type);
    Object.defineProperties(event, {
      key: { value: init.key },
      repeat: { value: init.repeat ?? false },
      timeStamp: { value: init.timeStamp ?? 0 },
    });
    target.dispatchEvent(event);
  };
  return { view, node, frame, key, target, isRunning: () => queued !== null };
}

describe("glideTimelineWhileHeld", () => {
  it("moves by time, not by repeats, and stops on keyup", () => {
    const { view, node, frame, key, isRunning } = setup();
    expect(glideTimelineWhileHeld(node, view, "ArrowDown", 1, 0)).toBe(true);
    // Further repeats of the held key keep it alive but do not start a second glide.
    expect(glideTimelineWhileHeld(node, view, "ArrowDown", 1, 0)).toBe(false);
    frame(0);
    for (let time = 16; time <= 160; time += 16) {
      if (time % 32 === 0) key("keydown", { key: "ArrowDown", repeat: true, timeStamp: time });
      frame(time);
    }
    expect(node.scrollTop).toBeCloseTo(1000 + TIMELINE_ARROW_GLIDE_PX_PER_SECOND * 0.16);
    key("keyup", { key: "ArrowDown" });
    expect(isRunning()).toBe(false);
    expect(glideTimelineWhileHeld(node, view, "ArrowDown", 1, 200)).toBe(true);
  });

  it("stops on another key, on blur, and when repeats stop arriving", () => {
    const first = setup();
    glideTimelineWhileHeld(first.node, first.view, "ArrowUp", -1, 0);
    first.frame(0);
    first.key("keydown", { key: "a" });
    expect(first.isRunning()).toBe(false);

    const second = setup();
    glideTimelineWhileHeld(second.node, second.view, "ArrowUp", -1, 0);
    second.target.dispatchEvent(new Event("blur"));
    expect(second.isRunning()).toBe(false);

    const third = setup();
    glideTimelineWhileHeld(third.node, third.view, "ArrowUp", -1, 0);
    third.frame(0);
    third.frame(400);
    expect(third.isRunning()).toBe(false);
    expect(third.node.scrollTop).toBe(1000);
  });
});
