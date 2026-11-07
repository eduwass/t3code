// ponytail: hop's "railgun" focus effect (beam + ring) in hop's colour. One shot, transform and
// opacity only, removed when done. Desktop webviews draw above the page, so it hides under one.
const COLOR = "#fad000";

const MIN_RING = 28;

/** Where the text cursor is in a rich-text editor, so the flash can land on it. */
export function caretRect(element: HTMLElement): DOMRect | undefined {
  const selection = element.ownerDocument.getSelection();
  if (!element.isContentEditable || !selection?.focusNode) return undefined;
  if (!element.contains(selection.focusNode)) return undefined;
  const range = element.ownerDocument.createRange();
  range.setStart(selection.focusNode, selection.focusOffset);
  const rect = range.getClientRects()[0];
  if (rect) return rect;
  // An empty line has no text to measure: use the start of the line itself.
  const node = selection.focusNode;
  const line = (node instanceof Element ? node : node.parentElement)?.getBoundingClientRect();
  return line && DOMRect.fromRect({ x: line.left, y: line.top, width: 0, height: line.height });
}

export function flashFocusMove(from: DOMRect, target: DOMRect) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // A text cursor, or a terminal's tiny input at its cursor, gets a round halo like hop's.
  const point = target.width < MIN_RING && target.height < MIN_RING;
  const width = Math.max(target.width, MIN_RING);
  const height = Math.max(target.height, MIN_RING);
  const to = DOMRect.fromRect({
    x: target.left - (width - target.width) / 2,
    y: target.top - (height - target.height) / 2,
    width,
    height,
  });
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const dx = to.left + to.width / 2 - fromX;
  const dy = to.top + to.height / 2 - fromY;
  const rotate = `rotate(${Math.atan2(dy, dx)}rad)`;

  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const beam = document.createElement("div");
  beam.style.cssText = `position:absolute;left:${fromX}px;top:${fromY - 1.5}px;width:${Math.hypot(dx, dy)}px;height:3px;border-radius:2px;transform-origin:0 50%;transform:${rotate};opacity:0;background:linear-gradient(90deg,transparent,${COLOR});box-shadow:0 0 12px ${COLOR}`;
  const ring = document.createElement("div");
  ring.style.cssText = `position:absolute;left:${to.left + 2}px;top:${to.top + 2}px;width:${to.width - 4}px;height:${to.height - 4}px;border:2px solid ${COLOR};border-radius:${point ? "50%" : "10px"};box-shadow:0 0 18px ${COLOR}8c,inset 0 0 18px ${COLOR}40`;
  layer.append(beam, ring);
  document.body.append(layer);

  beam.animate(
    [
      { transform: `${rotate} scaleX(0)`, opacity: 1 },
      { transform: `${rotate} scaleX(1)`, opacity: 1, offset: 0.55 },
      { transform: `${rotate} scaleX(1)`, opacity: 0 },
    ],
    { duration: 220, easing: "ease-out" },
  );
  ring
    .animate(
      [
        { opacity: 0, transform: "scale(1.015)" },
        { opacity: 0.55, transform: "scale(1)", offset: 0.35 },
        { opacity: 0, transform: "scale(1)" },
      ],
      { duration: 460, easing: "ease-out" },
    )
    .finished.finally(() => layer.remove());
}
