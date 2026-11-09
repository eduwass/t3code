import { describe, expect, it } from "vite-plus/test";

import { PaperJsxParseError, paperJsxToHtml } from "./paperJsxToHtml.ts";

const body = (html: string) => /<body>(.*)<\/body>/s.exec(html)?.[1];

describe("paperJsxToHtml", () => {
  it("renders Paper's inline-styles JSX as HTML", () => {
    const html = paperJsxToHtml(
      `(
    <div id="1-0" style={{ backgroundColor: '#0A0A0A', width: '390px', flexShrink: 0, fontWeight: 600, WebkitFontSmoothing: 'antialiased', fontFamily: '"Playfair Display", system-ui, sans-serif' }}>
      <span style={{ color: '#8E9A9D' }}> of 39 steps</span>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
        <defs><linearGradient id="_3PP-2__g0" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" offset="0" /></linearGradient></defs>
        <path d="M5 12h14" strokeWidth="2" strokeLinecap="round" fill="url(#_3PP-2__g0)" />
      </svg>
    </div>
  )`,
      "Home",
    );
    expect(body(html)).toBe(
      '<div data-paper-node="1-0" style="background-color:#0A0A0A;width:390px;flex-shrink:0;font-weight:600;-webkit-font-smoothing:antialiased;font-family:&quot;Playfair Display&quot;, system-ui, sans-serif">' +
        '<span style="color:#8E9A9D"> of 39 steps</span>' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">' +
        '<defs><linearGradient id="_3PP-2__g0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" offset="0"></stop></linearGradient></defs>' +
        '<path d="M5 12h14" stroke-width="2" stroke-linecap="round" fill="url(#_3PP-2__g0)"></path></svg></div>',
    );
    expect(html).toContain("fonts.googleapis.com/css?family=Playfair+Display:400,600");
  });

  it("keeps the space before an inline element, as JSX does", () => {
    const html = paperJsxToHtml(
      `<div>
        Ring the bell nearby drops a <span>Fragment</span>.
      </div>`,
      "x",
    );
    expect(body(html)).toBe("<div>Ring the bell nearby drops a <span>Fragment</span>.</div>");
  });

  it("drops anything that could run or load non-https content", () => {
    const html = body(
      paperJsxToHtml(
        `<div onClick="alert(1)" style={{ backgroundImage: 'url(http://evil.test/x.png)', color: 'red;}</style><script>' }}><script>alert(1)</script><img src="javascript:alert(1)" /><div style={{ backgroundImage: 'url(https://app.paper.design/file-assets/f/a.jpg)' }} /></div>`,
        "x",
      ),
    );
    expect(body(`<body>${html}</body>`)).toBe(
      '<div style="color:red}/stylescript"><img><div style="background-image:url(https://app.paper.design/file-assets/f/a.jpg)"></div></div>',
    );
  });

  it("defines the file's design tokens and nothing else from the token CSS", () => {
    const html = paperJsxToHtml(
      `<div style={{ backgroundColor: 'var(--color-page-light)' }} />`,
      "x",
      ":root {\n  --color-page-light: oklch(97% 0 0);\n  --color-border: red;}</style><script>x</script>;\n}",
    );
    expect(html).toContain("<style>:root{--color-page-light: oklch(97% 0 0);--color-border: red;}");
    expect(html).not.toContain("<script>x");
  });

  it("rejects input outside Paper's subset instead of guessing", () => {
    expect(() => paperJsxToHtml("<div>{items.map(render)}</div>", "x")).toThrow(PaperJsxParseError);
    expect(() => paperJsxToHtml("<div><span></div>", "x")).toThrow(PaperJsxParseError);
  });
});
