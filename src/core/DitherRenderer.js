import { DW, DH, CX, CY, W, H, getCanvasRefs } from '../utils/canvas.js';
import { angDiff } from '../utils/math.js';
import { getState, nPos } from '../nodes/NodeManager.js';

const MAX_BLEED = 180;

// ── Circle mask — original diffusion + directional gate ─────────────────────
// The original algorithm (angular proximity + radial distance decay) is preserved.
// The only addition: a gate that checks whether the arrow points OUTWARD
// at this pixel's boundary position. If the arrow points inward (toward center),
// no bleed. This prevents bleeding on the opposite side.
function getMaskCircle(px, py) {
  const state = getState();
  const { nodes, shapeRadius } = state;

  const dx = px - CX, dy = py - CY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const pixAng = Math.atan2(dy, dx);

  if (dist < shapeRadius * 0.92) return 1.0;

  if (dist < shapeRadius) {
    const t = (dist - shapeRadius * 0.92) / (shapeRadius * 0.08);
    return 1.0 - t * 0.08;
  }

  const outside = dist - shapeRadius;
  let maxVal = 0;

  // Outward normal at this pixel's angular position on the boundary
  const outX = Math.cos(pixAng);
  const outY = Math.sin(pixAng);

  for (const n of nodes) {
    if (n.bleed < 0.01) continue;

    // Directional gate: does the arrow point outward at this boundary position?
    // dot(arrow, outward_normal) — positive means arrow has outward component
    const arrowOut = outX * Math.cos(n.handleAngle) + outY * Math.sin(n.handleAngle);
    if (arrowOut < 0) continue;

    const ad = angDiff(pixAng, n.angle);
    const effectiveSpread = n.spread * (1 + n.bleed * 0.5);
    if (ad >= effectiveSpread * 1.5) continue;

    const angFactor = ad / effectiveSpread;
    const angW = angFactor < 1
      ? Math.cos(angFactor * Math.PI * 0.5) ** 1.5
      : Math.max(0, 1 - (angFactor - 1) * 2) * 0.3;

    if (angW < 0.001) continue;

    const decayRate = 0.025 / (n.bleed * 1.2 + 0.05);
    const distW = Math.exp(-outside * decayRate);

    // Scale bleed by how much the arrow points outward (0 = tangent, 1 = fully outward)
    const val = angW * distW * Math.sqrt(n.bleed) * Math.pow(arrowOut, 0.5);
    maxVal = Math.max(maxVal, val);
  }

  return Math.pow(maxVal, 0.8) * 0.95;
}

// ── SDF mask — original diffusion + directional gate ────────────────────────
function getMaskSDF(px, py, sdf) {
  const state = getState();
  const { nodes } = state;

  const sd = sdf.sampleSmooth(px, py);

  if (sd < -4) return 1.0;
  if (sd < 0) {
    return 1.0 - (sd + 4) / -4 * 0.08;
  }

  const info = sdf.getNearestBoundaryInfo(px, py);
  const pixT = info.t;
  let maxVal = 0;

  // Outward normal at this pixel's nearest boundary point
  const outX = info.normal.x;
  const outY = info.normal.y;

  for (const n of nodes) {
    if (n.bleed < 0.01) continue;

    // Directional gate: does the arrow point outward at this boundary position?
    const arrowOut = outX * Math.cos(n.handleAngle) + outY * Math.sin(n.handleAngle);
    if (arrowOut < 0) continue;

    let dt = Math.abs(pixT - n.t);
    if (dt > 0.5) dt = 1 - dt;

    const spreadT = n.spread / (Math.PI * 2);
    const effectiveSpread = spreadT * (1 + n.bleed * 0.5);
    if (dt >= effectiveSpread * 1.5) continue;

    const angFactor = dt / effectiveSpread;
    const angW = angFactor < 1
      ? Math.cos(angFactor * Math.PI * 0.5) ** 1.5
      : Math.max(0, 1 - (angFactor - 1) * 2) * 0.3;

    if (angW < 0.001) continue;

    const decayRate = 0.025 / (n.bleed * 1.2 + 0.05);
    const distW = Math.exp(-sd * decayRate);

    const val = angW * distW * Math.sqrt(n.bleed) * Math.pow(arrowOut, 0.5);
    maxVal = Math.max(maxVal, val);
  }

  return Math.pow(maxVal, 0.8) * 0.95;
}

// ── Dither coordinate computation ────────────────────────────────────────────
// Uses the shape's natural coordinate system so streaks follow the contour.
// Circle: polar angle = along (arc position), radius = across (lane distance)
// SDF:    parametric t = along, signed distance = across

function getDitherCoords(x, y, useCircle, sdf, flowDir) {
  if (useCircle) {
    const rx = x - CX, ry = y - CY;
    const r = Math.sqrt(rx * rx + ry * ry);
    const theta = Math.atan2(ry, rx);
    // along = arc position, increases in flow direction
    // across = radial distance, creates concentric streak lanes
    return { along: theta * 108 * flowDir, across: r };
  } else {
    // Boundary-relative: parametric position for along, SDF for across
    const nearIdx = sdf.getNearestIndex(x, y);
    const sd = sdf.sample(x, y);
    const pathLen = sdf.shape.pathLength;
    const along = (nearIdx / sdf.shape.numPoints) * pathLen * flowDir;
    const across = -sd + 200; // offset so lanes are stable (inside=positive)
    return { along, across };
  }
}

// ── Main render function ────────────────────────────────────────────────────
export function renderDither(t, sdf) {
  const { dctx, bctx, imgd, pxd, buf } = getCanvasRefs();
  const state = getState();
  const { fillDensity, speedMult, grainSpace, stretchPct, flowDir } = state;
  const useCircle = !sdf;

  // Clear to black
  for (let i = 0; i < pxd.length; i += 4) {
    pxd[i] = pxd[i + 1] = pxd[i + 2] = 0;
  }

  const getMask = useCircle ? getMaskCircle : (px, py) => getMaskSDF(px, py, sdf);

  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const mask = getMask(x, y);
      let v = 0;

      if (mask > 0.003) {
        const { along, across } = getDitherCoords(x, y, useCircle, sdf, flowDir);

        // Stable per-lane phase stagger based on across (radial/SDF distance)
        const laneH =
          Math.sin(across * 0.53) * 11.2 +
          Math.cos(across * 0.97) * 5.1 +
          Math.sin(across * 1.71) * 2.4 +
          Math.cos(across * 2.89) * 1.1;

        // Animate along the contour
        const animPos = along + laneH - t * (15 * speedMult);
        const phase = ((animPos % grainSpace) + grainSpace) % grainSpace;

        const dropLen = grainSpace * stretchPct * mask * (fillDensity * 1.6 + 0.2);

        if (phase < dropLen) {
          v = Math.round(255 * Math.pow(mask, 0.3));
        }
      }

      const i = (y * DW + x) * 4;
      pxd[i] = pxd[i + 1] = pxd[i + 2] = v;
    }
  }

  bctx.putImageData(imgd, 0, 0);
  dctx.drawImage(buf, 0, 0, W, H);
}

// Render to a custom canvas (for export)
export function renderToCanvas(t, sdf, targetCanvas, resMult, bgColor) {
  const state = getState();
  const { fillDensity, speedMult, grainSpace, stretchPct, flowDir } = state;
  const useCircle = !sdf;

  const ew = DW * resMult;
  const eh = DH * resMult;
  targetCanvas.width = ew;
  targetCanvas.height = eh;

  const ectx = targetCanvas.getContext('2d');
  const eImgd = ectx.createImageData(DW, DH);
  const ePxd = eImgd.data;

  const isTransparent = bgColor === 'transparent';

  // Set alpha channel
  for (let i = 3; i < ePxd.length; i += 4) {
    ePxd[i] = isTransparent ? 0 : 255;
  }

  // Set background
  if (!isTransparent && bgColor !== '#000000' && bgColor !== 'black') {
    const r = parseInt(bgColor.slice(1, 3), 16);
    const g = parseInt(bgColor.slice(3, 5), 16);
    const b = parseInt(bgColor.slice(5, 7), 16);
    for (let i = 0; i < ePxd.length; i += 4) {
      ePxd[i] = r;
      ePxd[i + 1] = g;
      ePxd[i + 2] = b;
    }
  }

  const getMask = useCircle ? getMaskCircle : (px, py) => getMaskSDF(px, py, sdf);

  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const mask = getMask(x, y);

      if (mask > 0.003) {
        const { along, across } = getDitherCoords(x, y, useCircle, sdf, flowDir);

        const laneH =
          Math.sin(across * 0.53) * 11.2 +
          Math.cos(across * 0.97) * 5.1 +
          Math.sin(across * 1.71) * 2.4 +
          Math.cos(across * 2.89) * 1.1;

        const animPos = along + laneH - t * (15 * speedMult);
        const phase = ((animPos % grainSpace) + grainSpace) % grainSpace;
        const dropLen = grainSpace * stretchPct * mask * (fillDensity * 1.6 + 0.2);

        if (phase < dropLen) {
          const v = Math.round(255 * Math.pow(mask, 0.3));
          const i = (y * DW + x) * 4;
          ePxd[i] = ePxd[i + 1] = ePxd[i + 2] = v;
          if (isTransparent) ePxd[i + 3] = v;
        }
      }
    }
  }

  // Render at dither resolution, then scale up
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = DW;
  tmpCanvas.height = DH;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.putImageData(eImgd, 0, 0);

  ectx.imageSmoothingEnabled = false;
  ectx.drawImage(tmpCanvas, 0, 0, ew, eh);
}
