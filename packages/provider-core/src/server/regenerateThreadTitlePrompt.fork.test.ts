import { describe, expect, it } from "vite-plus/test";

import { buildThreadTitlePrompt } from "./textGenerationPrompts.ts";

// A manual regenerate means the user rejected the current title; the prompt must not let the
// model hand it back, since an identical title is dropped and the click appears to do nothing.
describe("regenerate thread title prompt", () => {
  it("asks for a different title and skips automated notices", () => {
    const { prompt } = buildThreadTitlePrompt({ message: "USER:\nhi", previousTitle: "Old" });
    expect(prompt).toContain("Return a different title.");
    expect(prompt).toContain("most recent messages decide the title");
    expect(prompt).not.toContain("Keep the previous title unchanged");
  });
});
