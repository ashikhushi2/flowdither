import { DW, DH, CX, CY, W, H, getCanvasRefs } from '../utils/canvas.js';
import { getState, nPos, getNodeById, getAnchorById } from '../nodes/NodeManager.js';

const MAX_PARTICLES = 5000;

let px       = new Float32Array(MAX_PARTICLES);
let py       = new Float32Array(MAX_PARTICLES);
let pvx      = new Float32Array(MAX_PARTICLES);
let pvy      = new Float32Array(MAX_PARTICLES);
let plife    = new Float32Array(MAX_PARTICLES);
let pmaxLife = new Float32Array(MAX_PARTICLES);
let psize    = new Float32Array(MAX_PARTICLES);
let pescInf  = new Float32Array(MAX_PARTICLES);
let pfade    = new Float32Array(MAX_PARTICLES);

// Ballistic detachment state
let pdetach  = new Uint8Array(MAX_PARTICLES);     // 1 = detached, ballistic mode
let pdirX    = new Float32Array(MAX_PARTICLES);    // locked stream direction X
let pdirY    = new Float32Array(MAX_PARTICLES);    // locked stream direction Y
let pSpeed   = new Float32Array(MAX_PARTICLES);    // locked stream speed
let pSLen    = new Float32Array(MAX_PARTICLES);    // streamLength at detachment
let pDetachT = new Float32Array(MAX_PARTICLES);    // time since detachment (frames)
let pSourceNode = new Int16Array(MAX_PARTICLES);   // source node ID (-1 = none)

let count = 0;
let shape = null;
let sdf = null;

// ── Spawn ───────────────────────────────────────────────────────────────────
function spawnParticle(i) {
  const b = shape.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;

  for (let attempt = 0; attempt < 100; attempt++) {
    const x = b.minX + Math.random() * w;
    const y = b.minY + Math.random() * h;
    if (shape.isPointInside(x, y)) {
      px[i] = x;  py[i] = y;
      pvx[i] = 0; pvy[i] = 0;
      plife[i] = 200 + Math.random() * 300;
      pmaxLife[i] = plife[i];
      psize[i] = 1 + Math.random();
      pescInf[i] = 0;
      pfade[i] = 1;
      pdetach[i] = 0;
      pdirX[i] = 0; pdirY[i] = 0;
      pSpeed[i] = 0; pSLen[i] = 0;
      pDetachT[i] = 0;
      pSourceNode[i] = -1;
      return;
    }
  }

  const idx = Math.floor(Math.random() * shape.numPoints);
  px[i] = shape.points[idx].x;
  py[i] = shape.points[idx].y;
  pvx[i] = 0; pvy[i] = 0;
  plife[i] = 200 + Math.random() * 300;
  pmaxLife[i] = plife[i];
  psize[i] = 1 + Math.random();
  pescInf[i] = 0;
  pfade[i] = 1;
  pdetach[i] = 0;
  pdirX[i] = 0; pdirY[i] = 0;
  pSpeed[i] = 0; pSLen[i] = 0;
  pDetachT[i] = 0;
  pSourceNode[i] = -1;
}

// ── Init ────────────────────────────────────────────────────────────────────
export function init(newShape, newSdf, particleCount) {
  shape = newShape;
  sdf = newSdf;
  count = Math.min(particleCount, MAX_PARTICLES);

  for (let i = 0; i < count; i++) {
    spawnParticle(i);
    plife[i] = Math.random() * pmaxLife[i];
  }
}

// ── Update ──────────────────────────────────────────────────────────────────
export function update(dt) {
  if (!shape || !sdf || count === 0) return;

  const state = getState();
  const { nodes, flowDir, speedMult, grainSpace } = state;

  const baseSpeed = 30 * speedMult;
  const gravityK = 0.3;
  const grainAmp = Math.max(0.1, 20 - grainSpace) * 0.15;

  for (let i = 0; i < count; i++) {
    const x = px[i];
    const y = py[i];

    let vx, vy;

    // ═══════════════════════════════════════════════════════════════════════
    // BALLISTIC DETACHED PARTICLE — no path forces, straight-line travel
    // ═══════════════════════════════════════════════════════════════════════
    if (pdetach[i]) {
      const sLen = pSLen[i];
      const streamSpeed = pSpeed[i];
      const dx = pdirX[i];
      const dy = pdirY[i];

      // Pure ballistic: locked direction * locked speed
      vx = dx * streamSpeed;
      vy = dy * streamSpeed;

      // Slight perpendicular spread noise (widens stream, never re-steers)
      const perpX = -dy;
      const perpY = dx;
      const noise = (Math.random() - 0.5) * grainAmp * baseSpeed * 0.3;
      vx += perpX * noise;
      vy += perpY * noise;

      // Anchor influence on detached particles
      let anchorFadeDrain = 0;
      if (pSourceNode[i] >= 0) {
        const node = getNodeById(pSourceNode[i]);
        if (node) {
          for (const anchorId of node.linkedAnchors) {
            const anchor = getAnchorById(anchorId);
            if (!anchor) continue;
            const toAx = anchor.x - x, toAy = anchor.y - y;
            const adist = Math.sqrt(toAx * toAx + toAy * toAy) || 1;
            if (adist > anchor.radius) continue;
            const at = 1 - adist / anchor.radius;
            const influence = at * at;
            const adirX = toAx / adist, adirY = toAy / adist;
            const curSpeed = Math.sqrt(vx * vx + vy * vy) || 1;
            vx += (adirX * curSpeed - vx) * influence * anchor.strength;
            vy += (adirY * curSpeed - vy) * influence * anchor.strength;
            anchorFadeDrain += anchor.fade * influence;
          }
        }
      }

      // Only write back direction when an anchor actually pulled on the particle
      if (anchorFadeDrain > 0) {
        const newSpeed = Math.sqrt(vx * vx + vy * vy) || 1;
        pdirX[i] = vx / newSpeed;
        pdirY[i] = vy / newSpeed;
        pSpeed[i] = newSpeed;
      }

      // Slight sustain — never decelerates
      pSpeed[i] *= 1.001;

      // Time-based fade: fade linearly over stream lifetime
      pDetachT[i] += 1;
      const maxLife = 100 + sLen * 600; // frames: 100 at sLen=0, 700 at sLen=1
      const t = pDetachT[i] / maxLife;
      // Start from time-based fade, then subtract per-frame anchor drain
      pfade[i] = Math.max(0, 1 - t);
      if (anchorFadeDrain > 0) pfade[i] = Math.max(0, pfade[i] - anchorFadeDrain);

      // Life drain (constant, just a safety net)
      plife[i] -= 0.5;

      // Move
      px[i] = x + vx * dt;
      py[i] = y + vy * dt;
      pvx[i] = vx;
      pvy[i] = vy;

      // Respawn only when faded out or off canvas
      const newX = px[i];
      const newY = py[i];
      const offCanvas = newX < -200 || newX >= DW + 200 || newY < -200 || newY >= DH + 200;
      if (offCanvas || plife[i] <= 0 || pfade[i] <= 0) {
        spawnParticle(i);
      }
      continue;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ATTACHED PARTICLE — normal path-following behavior
    // ═══════════════════════════════════════════════════════════════════════
    let esc = pescInf[i];

    // 1. Nearest path point
    const info = sdf.getNearestBoundaryInfo(x, y);
    const tangent = info.tangent;
    const nearest = info.point;
    const dist = info.distance;

    // 2. Path tangent flow
    vx = tangent.x * baseSpeed * flowDir;
    vy = tangent.y * baseSpeed * flowDir;

    // 3. Gravity toward path
    const gx = nearest.x - x;
    const gy = nearest.y - y;
    const gStrength = gravityK * Math.min(dist * 0.05, 1.0);
    vx += gx * gStrength;
    vy += gy * gStrength;

    // 4. Flow stream node influence
    for (let ni = 0; ni < nodes.length; ni++) {
      const n = nodes[ni];
      if (n.bleed < 0.01) continue;

      const np = nPos(n);
      const ndx = np.x - x;
      const ndy = np.y - y;
      const ndist = Math.sqrt(ndx * ndx + ndy * ndy);

      const influenceR = n.spread * 80;
      if (ndist >= influenceR || ndist < 0.1) continue;

      const proximity = 1 - ndist / influenceR;
      const influence = proximity * proximity;

      // Grow escape influence
      esc += 0.03 * influence;
      if (esc > 1) esc = 1;

      const curSpeed = Math.sqrt(vx * vx + vy * vy) || 1;
      const hcos = Math.cos(n.handleAngle);
      const hsin = Math.sin(n.handleAngle);

      // Rotate velocity toward node direction
      const rotateStrength = influence * n.directionStrength;
      let newVx = vx + (hcos * curSpeed - vx) * rotateStrength;
      let newVy = vy + (hsin * curSpeed - vy) * rotateStrength;
      const newSpeed = Math.sqrt(newVx * newVx + newVy * newVy) || 1;
      vx = newVx / newSpeed * curSpeed;
      vy = newVy / newSpeed * curSpeed;

      // Accelerate once aligned
      const alignment = (vx * hcos + vy * hsin) / curSpeed;
      if (alignment > 0.3) {
        const accel = (alignment - 0.3) * influence * n.pull * 5.0 * (1 + n.streamLength * 1.5);
        vx += hcos * accel * baseSpeed;
        vy += hsin * accel * baseSpeed;
      }

      // Bleed stretch
      if (n.bleed > 0.01) {
        const bleedAccel = n.bleed * influence * n.stretch * 4.0 * (1 + n.streamLength * 1.5);
        vx += hcos * bleedAccel * baseSpeed;
        vy += hsin * bleedAccel * baseSpeed;
      }

      // ── DETACHMENT TRIGGER ──
      // When influence is strong enough, lock direction and go ballistic
      if (influence > 0.2 && esc > 0.15) {
        const speed = Math.sqrt(vx * vx + vy * vy) || 1;
        pdetach[i] = 1;
        pdirX[i] = vx / speed;
        pdirY[i] = vy / speed;
        pSpeed[i] = speed;
        pSLen[i] = n.streamLength;
        pDetachT[i] = 0;
        pfade[i] = 1;
        pSourceNode[i] = n.id;
      }
    }

    // Decay escape influence when outside all node radii
    if (esc < 0.01) {
      esc = 0;
    }
    pescInf[i] = esc;

    // Life drain
    plife[i] -= 1;

    // Grain noise
    vx += (Math.random() - 0.5) * grainAmp * baseSpeed * 0.2;
    vy += (Math.random() - 0.5) * grainAmp * baseSpeed * 0.2;

    // Move
    px[i] = x + vx * dt;
    py[i] = y + vy * dt;

    // Respawn
    const newX = px[i];
    const newY = py[i];
    const offCanvas = newX < -80 || newX >= DW + 80 || newY < -80 || newY >= DH + 80;
    const sd = sdf.sample(newX, newY);
    const outsideShape = sd > 0;

    if (offCanvas || plife[i] <= 0 || (outsideShape && esc < 0.1)) {
      spawnParticle(i);
    }

    pvx[i] = vx;
    pvy[i] = vy;
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

// Clear canvas with trail effect (called once per frame, before all assets render)
export function clearFrame(ctx, w, h, bgHex, stretchPct) {
  const trailAlpha = 0.05 + (1 - stretchPct) * 0.25;
  // Parse bg hex to rgb
  const r = parseInt(bgHex.slice(1, 3), 16) || 0;
  const g = parseInt(bgHex.slice(3, 5), 16) || 0;
  const b = parseInt(bgHex.slice(5, 7), 16) || 0;
  ctx.fillStyle = `rgba(${r},${g},${b},${trailAlpha})`;
  ctx.fillRect(0, 0, w, h);
}

// Render currently loaded particles WITHOUT clearing canvas
export function renderAssetParticles(ctx, w, h) {
  if (!shape || count === 0) return;
  drawParticles(ctx, w, h);
}

function parseHexColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16) || 255;
  const g = parseInt(hex.slice(3, 5), 16) || 255;
  const b = parseInt(hex.slice(5, 7), 16) || 255;
  return { r, g, b };
}

function drawParticles(ctx, w, h) {
  const NUM_BUCKETS = 8;
  const buckets = [];
  for (let b = 0; b < NUM_BUCKETS; b++) buckets.push([]);

  for (let i = 0; i < count; i++) {
    const fade = pfade[i];
    if (fade <= 0.01) continue;

    let alpha;
    if (pdetach[i]) {
      alpha = 0.6 * fade;
    } else {
      const sd = sdf.sample(px[i], py[i]);
      const absDist = Math.abs(sd);
      if (absDist < 5) {
        alpha = 0.9 + Math.random() * 0.1;
      } else if (absDist < 20) {
        alpha = 0.5 + 0.4 * (1 - (absDist - 5) / 15);
      } else {
        alpha = 0.3 + 0.2 * Math.max(0, 1 - absDist / 60);
      }
      alpha *= fade;
    }

    const bucket = Math.min(NUM_BUCKETS - 1, Math.floor(alpha * NUM_BUCKETS));
    buckets[bucket].push(i);
  }

  const scaleX = w / DW;
  const scaleY = h / DH;

  const state = getState();
  const { r, g, b: bl } = parseHexColor(state.particleColor || '#ffffff');

  for (let b = 0; b < NUM_BUCKETS; b++) {
    const particles = buckets[b];
    if (particles.length === 0) continue;
    const a = (b + 0.5) / NUM_BUCKETS;
    ctx.fillStyle = `rgba(${r},${g},${bl},${a.toFixed(3)})`;
    for (let j = 0; j < particles.length; j++) {
      const idx = particles[j];
      ctx.fillRect(px[idx] * scaleX, py[idx] * scaleY, psize[idx] * scaleX, psize[idx] * scaleX);
    }
  }
}

// (render/renderFrame/renderToCanvas removed — main loop uses clearFrame + renderAssetParticles)

export function reinit() {
  if (!shape) return;
  const state = getState();
  init(shape, sdf, Math.round(500 + state.fillDensity * 4500));
}

// Translate all particle positions and update shape/sdf references
export function translateParticles(dx, dy, newShape, newSdf) {
  shape = newShape;
  sdf = newSdf;
  for (let i = 0; i < count; i++) {
    px[i] += dx;
    py[i] += dy;
  }
}

// Scale all particle positions relative to (cx, cy) and update shape/sdf references
export function scaleParticles(factor, cx, cy, newShape, newSdf) {
  shape = newShape;
  sdf = newSdf;
  for (let i = 0; i < count; i++) {
    px[i] = cx + (px[i] - cx) * factor;
    py[i] = cy + (py[i] - cy) * factor;
  }
}

// Rotate all particle positions by angle (radians) around (cx, cy) and update shape/sdf references
export function rotateParticles(angle, cx, cy, newShape, newSdf) {
  shape = newShape;
  sdf = newSdf;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let i = 0; i < count; i++) {
    const dx = px[i] - cx, dy = py[i] - cy;
    px[i] = cx + dx * cos - dy * sin;
    py[i] = cy + dx * sin + dy * cos;
  }
}

// ── Save/Restore (for file switching) ────────────────────────────────────────
export function saveParticleState() {
  return {
    px: px.slice(), py: py.slice(),
    pvx: pvx.slice(), pvy: pvy.slice(),
    plife: plife.slice(), pmaxLife: pmaxLife.slice(),
    psize: psize.slice(), pescInf: pescInf.slice(), pfade: pfade.slice(),
    pdetach: pdetach.slice(), pdirX: pdirX.slice(), pdirY: pdirY.slice(),
    pSpeed: pSpeed.slice(), pSLen: pSLen.slice(), pDetachT: pDetachT.slice(),
    pSourceNode: pSourceNode.slice(),
    count,
    shape, sdf,
  };
}

export function restoreParticleState(snapshot) {
  if (!snapshot) {
    reset();
    return;
  }
  px.set(snapshot.px); py.set(snapshot.py);
  pvx.set(snapshot.pvx); pvy.set(snapshot.pvy);
  plife.set(snapshot.plife); pmaxLife.set(snapshot.pmaxLife);
  psize.set(snapshot.psize); pescInf.set(snapshot.pescInf); pfade.set(snapshot.pfade);
  pdetach.set(snapshot.pdetach); pdirX.set(snapshot.pdirX); pdirY.set(snapshot.pdirY);
  pSpeed.set(snapshot.pSpeed); pSLen.set(snapshot.pSLen); pDetachT.set(snapshot.pDetachT);
  pSourceNode.set(snapshot.pSourceNode);
  count = snapshot.count;
  shape = snapshot.shape;
  sdf = snapshot.sdf;
}

export function reset() {
  count = 0;
  shape = null;
  sdf = null;
  px.fill(0); py.fill(0);
  pvx.fill(0); pvy.fill(0);
  plife.fill(0); pmaxLife.fill(0);
  psize.fill(0); pescInf.fill(0); pfade.fill(0);
  pdetach.fill(0); pdirX.fill(0); pdirY.fill(0);
  pSpeed.fill(0); pSLen.fill(0); pDetachT.fill(0);
  pSourceNode.fill(-1);
}

export function getParticleShape() { return shape; }
export function getParticleSdf() { return sdf; }

// ── Multi-asset snapshot support ──────────────────────────────────────────────

export function createParticleSnapshot(maxCount) {
  return {
    px: new Float32Array(maxCount),
    py: new Float32Array(maxCount),
    pvx: new Float32Array(maxCount),
    pvy: new Float32Array(maxCount),
    plife: new Float32Array(maxCount),
    pmaxLife: new Float32Array(maxCount),
    psize: new Float32Array(maxCount),
    pescInf: new Float32Array(maxCount),
    pfade: new Float32Array(maxCount),
    pdetach: new Uint8Array(maxCount),
    pdirX: new Float32Array(maxCount),
    pdirY: new Float32Array(maxCount),
    pSpeed: new Float32Array(maxCount),
    pSLen: new Float32Array(maxCount),
    pDetachT: new Float32Array(maxCount),
    pSourceNode: new Int16Array(maxCount).fill(-1),
    count: 0,
    maxCount,
    shape: null,
    sdf: null,
  };
}

export function loadFromSnapshot(snap) {
  const n = Math.min(snap.count, MAX_PARTICLES);
  px.set(snap.px.subarray(0, snap.maxCount));
  py.set(snap.py.subarray(0, snap.maxCount));
  pvx.set(snap.pvx.subarray(0, snap.maxCount));
  pvy.set(snap.pvy.subarray(0, snap.maxCount));
  plife.set(snap.plife.subarray(0, snap.maxCount));
  pmaxLife.set(snap.pmaxLife.subarray(0, snap.maxCount));
  psize.set(snap.psize.subarray(0, snap.maxCount));
  pescInf.set(snap.pescInf.subarray(0, snap.maxCount));
  pfade.set(snap.pfade.subarray(0, snap.maxCount));
  pdetach.set(snap.pdetach.subarray(0, snap.maxCount));
  pdirX.set(snap.pdirX.subarray(0, snap.maxCount));
  pdirY.set(snap.pdirY.subarray(0, snap.maxCount));
  pSpeed.set(snap.pSpeed.subarray(0, snap.maxCount));
  pSLen.set(snap.pSLen.subarray(0, snap.maxCount));
  pDetachT.set(snap.pDetachT.subarray(0, snap.maxCount));
  pSourceNode.set(snap.pSourceNode.subarray(0, snap.maxCount));
  count = n;
  shape = snap.shape;
  sdf = snap.sdf;
}

export function saveToSnapshot(snap) {
  const n = Math.min(count, snap.maxCount);
  snap.px.set(px.subarray(0, snap.maxCount));
  snap.py.set(py.subarray(0, snap.maxCount));
  snap.pvx.set(pvx.subarray(0, snap.maxCount));
  snap.pvy.set(pvy.subarray(0, snap.maxCount));
  snap.plife.set(plife.subarray(0, snap.maxCount));
  snap.pmaxLife.set(pmaxLife.subarray(0, snap.maxCount));
  snap.psize.set(psize.subarray(0, snap.maxCount));
  snap.pescInf.set(pescInf.subarray(0, snap.maxCount));
  snap.pfade.set(pfade.subarray(0, snap.maxCount));
  snap.pdetach.set(pdetach.subarray(0, snap.maxCount));
  snap.pdirX.set(pdirX.subarray(0, snap.maxCount));
  snap.pdirY.set(pdirY.subarray(0, snap.maxCount));
  snap.pSpeed.set(pSpeed.subarray(0, snap.maxCount));
  snap.pSLen.set(pSLen.subarray(0, snap.maxCount));
  snap.pDetachT.set(pDetachT.subarray(0, snap.maxCount));
  snap.pSourceNode.set(pSourceNode.subarray(0, snap.maxCount));
  snap.count = n;
  snap.shape = shape;
  snap.sdf = sdf;
}
