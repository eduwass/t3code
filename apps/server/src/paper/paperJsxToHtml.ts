// T3 Space fork. Turns Paper's `get_jsx` output (inline-styles format) into a
// standalone HTML document. Paper emits a small, regular JSX subset: elements,
// string attributes, `style={{ … }}` objects of string/number literals, and
// text. Anything outside it fails the parse instead of being guessed at.
import { PAPER_FRAME_SIZE_MESSAGE } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const ALLOWED_TAGS = new Set([
  "div",
  "span",
  "p",
  "img",
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "text",
  "tspan",
]);
const VOID_TAGS = new Set(["img"]);
const UNITLESS = new Set([
  "opacity",
  "zIndex",
  "fontWeight",
  "lineHeight",
  "flexGrow",
  "flexShrink",
  "order",
  "zoom",
  "flex",
  "aspectRatio",
]);
const SVG_KEEP_CASE = new Set([
  "viewBox",
  "preserveAspectRatio",
  "gradientUnits",
  "gradientTransform",
]);
// SVG defs that shapes point at with url(#id); renaming their id leaves the shape unpainted.
const SVG_REFERENCED = new Set(["linearGradient", "radialGradient", "clipPath", "mask"]);
const GENERIC_FONTS = new Set([
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
]);

export class PaperJsxParseError extends Schema.TaggedError<PaperJsxParseError>()(
  "PaperJsxParseError",
  { detail: Schema.String },
) {}

type Value = string | number | boolean | { readonly [key: string]: Value };

interface Element {
  readonly tag: string;
  readonly attrs: ReadonlyArray<readonly [string, Value]>;
  readonly children: ReadonlyArray<Element | string>;
}

/** JSX text rules: trim only where a line break is, drop blank lines, join lines with a space. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return raw;
  return lines
    .map((line, index) => {
      let text = line;
      if (index > 0) text = text.replace(/^[ \t]+/, "");
      if (index < lines.length - 1) text = text.replace(/[ \t]+$/, "");
      return text;
    })
    .filter((line) => line !== "")
    .join(" ");
}

function parse(source: string): Element {
  let i = 0;
  const fail = (what: string): never => {
    throw new PaperJsxParseError({ detail: `${what} at ${i}` });
  };
  const ws = () => {
    while (i < source.length && /\s/.test(source[i]!)) i++;
  };
  const ident = () => {
    const match = /^[A-Za-z_$][\w$-]*/.exec(source.slice(i));
    if (!match) fail("expected name");
    i += match![0].length;
    return match![0];
  };
  const string = () => {
    const quote = source[i]!;
    let out = "";
    i++;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") {
        const next = source[i + 1];
        out += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
        i += 2;
      } else out += source[i++];
    }
    if (source[i] !== quote) fail("unterminated string");
    i++;
    return out;
  };
  const value = (): Value => {
    ws();
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === "`") return string();
    if (ch === "{") {
      i++;
      const obj: Record<string, Value> = {};
      for (;;) {
        ws();
        if (source[i] === "}") break;
        const key = source[i] === "'" || source[i] === '"' ? string() : ident();
        ws();
        if (source[i] !== ":") fail("expected :");
        i++;
        obj[key] = value();
        ws();
        if (source[i] === ",") i++;
      }
      i++;
      return obj;
    }
    const num = /^-?\d+(?:\.\d+)?/.exec(source.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    if (source.startsWith("true", i)) return ((i += 4), true);
    if (source.startsWith("false", i)) return ((i += 5), false);
    return fail("unsupported value");
  };
  const element = (): Element => {
    if (source[i] !== "<") fail("expected <");
    i++;
    const tag = ident();
    const attrs: Array<readonly [string, Value]> = [];
    for (;;) {
      ws();
      if (source.startsWith("/>", i)) return ((i += 2), { tag, attrs, children: [] });
      if (source[i] === ">") break;
      const name = ident();
      ws();
      if (source[i] !== "=") {
        attrs.push([name, true]);
        continue;
      }
      i++;
      ws();
      if (source[i] === "{") {
        i++;
        attrs.push([name, value()]);
        ws();
        if (source[i] !== "}") fail("expected }");
        i++;
      } else attrs.push([name, string()]);
    }
    i++;
    const children: Array<Element | string> = [];
    for (;;) {
      if (i >= source.length) fail(`unclosed <${tag}>`);
      if (source.startsWith("</", i)) {
        i += 2;
        if (ident() !== tag) fail(`mismatched </${tag}>`);
        ws();
        i++;
        return { tag, attrs, children };
      }
      if (source[i] === "<") children.push(element());
      else if (source[i] === "{") {
        i++;
        const inner = value();
        ws();
        i++;
        children.push(String(inner));
      } else {
        const start = i;
        while (i < source.length && source[i] !== "<" && source[i] !== "{") i++;
        const text = jsxText(source.slice(start, i));
        if (text !== "") children.push(text);
      }
    }
  };
  let body = source.trim();
  if (body.startsWith("(") && body.endsWith(")")) body = body.slice(1, -1).trim();
  source = body;
  const root = element();
  ws();
  if (i !== source.length) fail("trailing content");
  return root;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const kebab = (key: string): string =>
  /^(Webkit|Moz|ms)[A-Z]/.test(key)
    ? `-${kebab(key[0]!.toLowerCase() + key.slice(1))}`
    : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

interface Collected {
  readonly fonts: Set<string>;
  readonly weights: Set<number>;
}

function styleText(style: Value, collected: Collected): string {
  if (typeof style !== "object") return "";
  return Object.entries(style)
    .flatMap(([key, raw]) => {
      if (typeof raw === "object" || typeof raw === "boolean") return [];
      let text =
        typeof raw === "number" && raw !== 0 && !UNITLESS.has(key) ? `${raw}px` : String(raw);
      // Only https images; anything else in url() could reach the viewer's network.
      if (/url\(/i.test(text) && !/url\(\s*["']?https:\/\//i.test(text)) return [];
      text = text.replace(/[;<>]/g, "");
      if (key === "fontWeight") collected.weights.add(Number(raw));
      if (key === "fontFamily") {
        for (const family of text.split(","))
          collected.fonts.add(family.trim().replace(/^["']|["']$/g, ""));
      }
      return [`${kebab(key)}:${text}`];
    })
    .join(";");
}

function attrName(name: string, inSvg: boolean, tag: string): string | null {
  if (/^on/i.test(name) || name === "dangerouslySetInnerHTML" || name === "ref" || name === "key")
    return null;
  if (name === "className") return "class";
  if (name === "id") return SVG_REFERENCED.has(tag) ? "id" : "data-paper-node";
  if (inSvg && /[A-Z]/.test(name) && !SVG_KEEP_CASE.has(name)) return kebab(name);
  return name;
}

function render(node: Element | string, inSvg: boolean, collected: Collected): string {
  if (typeof node === "string") return escapeHtml(node);
  const svg = inSvg || node.tag === "svg";
  if (!ALLOWED_TAGS.has(node.tag)) return "";
  const attrs = node.attrs
    .flatMap(([name, value]) => {
      if (name === "style") return [` style="${escapeHtml(styleText(value, collected))}"`];
      const html = attrName(name, svg, node.tag);
      if (html === null || typeof value === "object") return [];
      const text = String(value);
      if ((html === "src" || html === "href") && !/^https:\/\//i.test(text)) return [];
      return [` ${html}="${escapeHtml(text)}"`];
    })
    .join("");
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  const children = node.children.map((child) => render(child, svg, collected)).join("");
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

/** Google Fonts' v1 CSS API skips weights a family lacks; v2 rejects the whole request. */
function fontLinks(collected: Collected): string {
  const weights = [...collected.weights].filter(Number.isFinite).sort((a, b) => a - b);
  const list = (weights.length > 0 ? weights : [400]).join(",");
  return [...collected.fonts]
    .filter((family) => family !== "" && !GENERIC_FONTS.has(family) && !/[-_]Regular/.test(family))
    .map(
      (family) =>
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${list}&display=block">`,
    )
    .join("");
}

/** The root's own px size; Paper reports none for content-sized frames off the active page. */
export function paperJsxRootSize(jsx: string): { width: number | null; height: number | null } {
  const style = parse(jsx).attrs.find(([name]) => name === "style")?.[1];
  const px = (value: Value | undefined) =>
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?px$/.test(value)
        ? Number.parseFloat(value)
        : null;
  return typeof style === "object"
    ? { width: px(style.width), height: px(style.height) }
    : { width: null, height: null };
}

// Our own script, never Paper's: reports the rendered size once fonts and images settle,
// because content-sized frames have no size until a browser lays them out.
const SIZE_REPORTER = `<script>addEventListener("load",()=>document.fonts.ready.then(()=>{const r=document.body.firstElementChild?.getBoundingClientRect();if(r)parent.postMessage({type:"${PAPER_FRAME_SIZE_MESSAGE}",width:Math.ceil(r.width),height:Math.ceil(r.height)},"*")}))</script>`;

/** Keeps only `--name: value;` declarations from Paper's `get_tokens` CSS, so nothing can leave the rule. */
function paperTokensCss(css: string): string {
  const declarations = css.match(/--[\w-]+\s*:\s*[^;{}<>]+;/g) ?? [];
  return declarations.length === 0 ? "" : `:root{${declarations.join("")}}`;
}

export function paperJsxToHtml(jsx: string, title: string, tokensCss = ""): string {
  const collected: Collected = { fonts: new Set(), weights: new Set([400]) };
  const body = render(parse(jsx), false, collected);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${fontLinks(collected)}${SIZE_REPORTER}<style>${paperTokensCss(tokensCss)}html,body{margin:0;padding:0;background:transparent}*{box-sizing:border-box}body>*:first-child{overflow:hidden}</style></head><body>${body}</body></html>`;
}
