import { assert, describe, it } from "@effect/vitest";

import { cascadeWindowBounds } from "./AdditionalWindows.ts";

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe("cascadeWindowBounds", () => {
  it("offsets from the focused window and wraps at the display edge", () => {
    assert.deepStrictEqual(
      cascadeWindowBounds({ x: 100, y: 100, width: 1100, height: 780 }, [display]),
      {
        x: 128,
        y: 128,
        width: 1100,
        height: 780,
      },
    );
    assert.deepStrictEqual(
      cascadeWindowBounds({ x: 800, y: 290, width: 1100, height: 780 }, [display]),
      {
        x: 28,
        y: 28,
        width: 1100,
        height: 780,
      },
    );
    assert.strictEqual(cascadeWindowBounds(null, [display]), null);
  });
});
