import { assert, describe, it } from "@effect/vitest";

import { windowLinkView } from "./DesktopWindowLinks.ts";

describe("windowLinkView", () => {
  it("reads the view from window links and ignores every other URL", () => {
    assert.strictEqual(windowLinkView("t3space://window?only=goldflower"), "only=goldflower");
    assert.strictEqual(windowLinkView("t3space://window/?view=Work"), "view=Work");
    assert.strictEqual(windowLinkView("t3space://window"), "");
    assert.strictEqual(windowLinkView("t3space://threads/abc"), null);
    assert.strictEqual(windowLinkView("t3code://window?only=goldflower"), null);
    assert.strictEqual(windowLinkView("not a url"), null);
  });
});
