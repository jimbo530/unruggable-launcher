// @ts-check
/**
 * camera.js — P7: the VIEWPORT layer over the SVG battle board.
 *
 * REQUIRED for ship-scale / multi-ship decks (a 20-long deck or two joined ships won't fit a
 * phone screen). This is PURE RENDER/UX: it changes ONLY the SVG `viewBox` (pan/zoom) and owns
 * its own little on-board control buttons. It NEVER touches combat state, units, or the engine —
 * game.js keeps drawing into board-content coordinates exactly as before; the camera just decides
 * which window of that content is shown.
 *
 *   • PAN   — drag / swipe (one pointer).
 *   • ZOOM  — mouse wheel, pinch (two pointers), and +/− buttons — all anchored on the focal point.
 *   • FIT / RECENTER — a ⤢ button (and double-tap) snaps back to the whole board.
 *   • FOLLOW-ACTIVE — game.js calls camera.focusOn(x, y) at the top of each turn to glide the view
 *                     onto the active unit (clamped so a small board barely moves).
 *
 * MOBILE-FIRST: built on Pointer Events (unified mouse + touch + pen) with a wheel fallback, and
 * sets `touch-action: none` on the board so the browser doesn't steal the pan/pinch gestures.
 *
 * COORDINATE MODEL: the board's CONTENT size = the SVG's width/height attributes (game.js's
 * ensureBoardSize() sets these to the full grid pixel dimensions). The viewBox is a window
 * { x, y, w, h } into that content. fit() sets the window to the whole content; zoom shrinks/grows
 * w/h (clamped); pan slides x/y (clamped with a small margin). Re-call fit() after a grid resize.
 *
 * node --check clean. Browser-only at runtime (uses DOM/PointerEvent); node never imports it.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Create a camera bound to an <svg> board element. Idempotent listeners (attach once).
 * @param {SVGSVGElement|any} svg  the #board element
 * @param {{ minScale?:number, maxScale?:number, controls?:boolean }} [opts]
 */
export function createCamera(svg, opts = {}) {
  const minScale = opts.minScale ?? 1.0;   // can't zoom OUT past the whole board (scale 1 = fit)
  const maxScale = opts.maxScale ?? 4.0;   // up to 4× zoom IN
  const showControls = opts.controls !== false;

  // content (board) size + the live viewBox window
  let content = readContent(svg);
  let vb = { x: 0, y: 0, w: content.w, h: content.h };

  // ── apply: the ONLY thing that ever writes the viewBox ──
  function apply() {
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  function readContentSize() {
    content = readContent(svg);
  }

  // clamp the window inside the content (allow a small overscroll margin so edges are reachable)
  function clamp() {
    vb.w = Math.min(Math.max(vb.w, content.w / maxScale), content.w / minScale);
    vb.h = Math.min(Math.max(vb.h, content.h / maxScale), content.h / minScale);
    const mx = vb.w * 0.15, my = vb.h * 0.15;                 // 15% overscroll
    vb.x = Math.min(Math.max(vb.x, -mx), Math.max(-mx, content.w - vb.w + mx));
    vb.y = Math.min(Math.max(vb.y, -my), Math.max(-my, content.h - vb.h + my));
  }

  /** Snap to the whole board (fit/recenter). Also picks up a new content size after a grid resize. */
  function fit() {
    readContentSize();
    vb = { x: 0, y: 0, w: content.w, h: content.h };
    apply();
  }

  /** Glide the view so (cx, cy) in CONTENT coords sits at the center (keeps the current zoom). */
  function focusOn(cx, cy) {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    vb.x = cx - vb.w / 2;
    vb.y = cy - vb.h / 2;
    clamp();
    apply();
  }

  // px (client) → content units, using the SVG's on-screen rect
  function clientToContent(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: vb.x, y: vb.y };
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  }

  /** Zoom by `factor` (<1 = in) anchored so the content point under (clientX,clientY) stays put. */
  function zoomAt(factor, clientX, clientY) {
    const before = clientToContent(clientX, clientY);
    const newW = vb.w * factor, newH = vb.h * factor;
    // clamp the zoom level first
    const cw = Math.min(Math.max(newW, content.w / maxScale), content.w / minScale);
    const ch = Math.min(Math.max(newH, content.h / maxScale), content.h / minScale);
    const rect = svg.getBoundingClientRect();
    const fx = rect.width ? (clientX - rect.left) / rect.width : 0.5;
    const fy = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    vb.w = cw; vb.h = ch;
    vb.x = before.x - fx * vb.w;       // keep the focal content point under the cursor
    vb.y = before.y - fy * vb.h;
    clamp();
    apply();
  }

  function zoomCenter(factor) {
    const rect = svg.getBoundingClientRect();
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // ── POINTER GESTURES (pan with 1 pointer, pinch-zoom with 2) ──
  const pointers = new Map();
  let panLast = null;          // {x,y} client of the active 1-pointer pan
  let pinchPrev = 0;           // previous 2-pointer distance

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { panLast = { x: e.clientX, y: e.clientY }; }
    else if (pointers.size === 2) { panLast = null; pinchPrev = pinchDistance(); }
    try { svg.setPointerCapture(e.pointerId); } catch (_) { /* capture optional */ }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      // pinch: scale by the change in finger spacing, anchored on the midpoint
      const d = pinchDistance();
      if (pinchPrev > 0 && d > 0) {
        const mid = pinchMid();
        zoomAt(pinchPrev / d, mid.x, mid.y);
      }
      pinchPrev = d;
      e.preventDefault();
      return;
    }
    if (panLast) {
      const rect = svg.getBoundingClientRect();
      const sx = rect.width ? vb.w / rect.width : 1;
      const sy = rect.height ? vb.h / rect.height : 1;
      vb.x -= (e.clientX - panLast.x) * sx;
      vb.y -= (e.clientY - panLast.y) * sy;
      panLast = { x: e.clientX, y: e.clientY };
      clamp();
      apply();
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (pointers.size === 1) {
      const only = pointers.values().next().value;
      panLast = only ? { x: only.x, y: only.y } : null;   // hand back to single-pointer pan
      pinchPrev = 0;
    } else if (pointers.size === 0) {
      panLast = null; pinchPrev = 0;
    }
  }

  function pinchDistance() {
    const p = [...pointers.values()];
    if (p.length < 2) return 0;
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  function pinchMid() {
    const p = [...pointers.values()];
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  }

  function onWheel(e) {
    e.preventDefault();
    zoomAt(e.deltaY > 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
  }

  let lastTap = 0;
  function onDblClick(e) { e.preventDefault(); fit(); }
  function onPointerTapForFit(e) {
    const now = Date.now();
    if (now - lastTap < 300) { fit(); lastTap = 0; } else { lastTap = now; }   // double-tap → fit (touch)
  }

  // ── on-board controls (the camera's OWN UI; not combat) ──
  let controlsEl = null;
  function buildControls() {
    if (!showControls) return;
    const parent = svg.parentElement;
    if (!parent) return;
    const cs = getComputedStyle(parent);
    if (cs.position === "static") parent.style.position = "relative";   // anchor the overlay
    controlsEl = document.createElement("div");
    controlsEl.className = "cam-controls";
    controlsEl.style.cssText =
      "position:absolute;right:8px;bottom:8px;display:flex;gap:6px;z-index:5;" +
      "font-family:inherit;user-select:none;";
    const mkBtn = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.title = title;
      b.style.cssText =
        "width:34px;height:34px;border-radius:8px;border:1px solid rgba(0,0,0,0.35);" +
        "background:rgba(20,14,6,0.78);color:#f0e6d2;font-size:18px;line-height:1;cursor:pointer;" +
        "box-shadow:0 1px 3px rgba(0,0,0,0.4);touch-action:manipulation;";
      b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); });
      // keep button taps from starting a board pan
      b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      return b;
    };
    controlsEl.appendChild(mkBtn("−", "Zoom out", () => zoomCenter(1.25)));   // −
    controlsEl.appendChild(mkBtn("⤢", "Fit / recenter the board", () => fit())); // ⤢
    controlsEl.appendChild(mkBtn("+", "Zoom in", () => zoomCenter(1 / 1.25)));
    parent.appendChild(controlsEl);
  }

  // ── attach / detach ──
  let attached = false;
  function attach() {
    if (attached) return;
    attached = true;
    try {
      svg.style.touchAction = "none";        // let the camera own pan/pinch (don't scroll the page)
      svg.style.maxWidth = "100%";           // MOBILE-FIRST: scale the board down to the screen…
      svg.style.height = "auto";             // …preserving the viewBox aspect ratio (pan/zoom on top)
    } catch (_) { /* ignore */ }
    svg.style.cursor = "grab";
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("pointerleave", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("dblclick", onDblClick);
    svg.addEventListener("pointerdown", onPointerTapForFit);
    buildControls();
  }
  function detach() {
    if (!attached) return;
    attached = false;
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", onPointerUp);
    svg.removeEventListener("pointercancel", onPointerUp);
    svg.removeEventListener("pointerleave", onPointerUp);
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("dblclick", onDblClick);
    svg.removeEventListener("pointerdown", onPointerTapForFit);
    if (controlsEl && controlsEl.parentElement) controlsEl.parentElement.removeChild(controlsEl);
    controlsEl = null;
  }

  attach();
  fit();

  return {
    fit, focusOn, attach, detach,
    zoomIn: () => zoomCenter(1 / 1.25),
    zoomOut: () => zoomCenter(1.25),
    onResize: fit,                       // game.js calls this after a grid-size change
    get viewBox() { return { ...vb }; }, // read-only peek (tests/debug)
  };
}

/** Read the board's CONTENT size from its width/height attributes (set by game.js ensureBoardSize). */
function readContent(svg) {
  const w = parseFloat(svg.getAttribute("width")) || (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) || 600;
  const h = parseFloat(svg.getAttribute("height")) || (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height) || 400;
  return { w, h };
}

export default createCamera;
