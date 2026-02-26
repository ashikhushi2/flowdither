export const SCALE = 3;
export let DW = 600;
export let DH = 600;
export let W = DW * SCALE;
export let H = DH * SCALE;
export let CX = DW / 2;
export let CY = DH / 2;

let dc, oc, dctx, octx, buf, bctx, imgd, pxd;
let canvasZoom = 1;
let panX = 0, panY = 0;

export function setCanvasDimensions(dw, dh) {
  DW = dw;
  DH = dh;
  W = DW * SCALE;
  H = DH * SCALE;
  CX = DW / 2;
  CY = DH / 2;
}

export function initCanvas() {
  dc = document.getElementById('dither-canvas');
  oc = document.getElementById('overlay-canvas');
  dc.width = oc.width = W;
  dc.height = oc.height = H;

  dctx = dc.getContext('2d');
  dctx.imageSmoothingEnabled = false;
  octx = oc.getContext('2d');

  buf = document.createElement('canvas');
  buf.width = DW;
  buf.height = DH;
  bctx = buf.getContext('2d');
  imgd = bctx.createImageData(DW, DH);
  pxd = imgd.data;
  for (let i = 3; i < pxd.length; i += 4) pxd[i] = 255;

  resize();
  window.addEventListener('resize', resize);

  return { dc, oc, dctx, octx, buf, bctx, imgd, pxd };
}

export function resizeCanvasElements() {
  if (!dc) return;
  dc.width = oc.width = W;
  dc.height = oc.height = H;
  dctx = dc.getContext('2d');
  dctx.imageSmoothingEnabled = false;
  octx = oc.getContext('2d');

  buf.width = DW;
  buf.height = DH;
  bctx = buf.getContext('2d');
  imgd = bctx.createImageData(DW, DH);
  pxd = imgd.data;
  for (let i = 3; i < pxd.length; i += 4) pxd[i] = 255;

  resize();
}

export function getCanvasRefs() {
  return { dc, oc, dctx, octx, buf, bctx, imgd, pxd };
}

export function resize() {
  if (!dc) return;
  const wrap = document.getElementById('canvas-wrap');
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  const baseScale = Math.min(availW / W, availH / H) * 0.95;
  const dispW = Math.round(W * baseScale * canvasZoom);
  const dispH = Math.round(H * baseScale * canvasZoom);
  [dc, oc].forEach(el => {
    el.style.width = dispW + 'px';
    el.style.height = dispH + 'px';
    el.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`;
  });
}

export function getCanvasZoom() { return canvasZoom; }

export function setCanvasZoom(z) {
  canvasZoom = Math.max(0.25, Math.min(5, z));
  resize();
}

export function setCanvasPan(x, y) {
  panX = x;
  panY = y;
  resize();
}

export function getCanvasPan() { return { x: panX, y: panY }; }

export function resetCanvasView() {
  canvasZoom = 1;
  panX = 0;
  panY = 0;
  resize();
}

export function toDither(e) {
  if (!oc) return { x: 0, y: 0 };
  const r = oc.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * DW,
    y: (e.clientY - r.top) / r.height * DH,
  };
}
