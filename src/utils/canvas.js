export const SCALE = 3;
export const DW = 600;
export const DH = 600;
export const W = DW * SCALE;
export const H = DH * SCALE;
export const CX = DW / 2;
export const CY = DH / 2;

let dc, oc, dctx, octx, buf, bctx, imgd, pxd;

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

export function getCanvasRefs() {
  return { dc, oc, dctx, octx, buf, bctx, imgd, pxd };
}

export function resize() {
  if (!dc) return;
  const wrap = document.getElementById('canvas-wrap');
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  const scale = Math.min(availW / W, availH / H) * 0.95;
  const dispW = Math.round(W * scale);
  const dispH = Math.round(H * scale);
  [dc, oc].forEach(el => {
    el.style.width = dispW + 'px';
    el.style.height = dispH + 'px';
  });
}

export function toDither(e) {
  if (!oc) return { x: 0, y: 0 };
  const r = oc.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * DW,
    y: (e.clientY - r.top) / r.height * DH,
  };
}
