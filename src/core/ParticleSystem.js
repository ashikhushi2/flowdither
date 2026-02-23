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
export function render(ctx, w, h) {
  if (!shape || count === 0) return;

  const state = getState();
  const { stretchPct } = state;

  const trailAlpha = 0.05 + (1 - stretchPct) * 0.25;
  ctx.fillStyle = `rgba(0,0,0,${trailAlpha})`;
  ctx.fillRect(0, 0, w, h);

  const NUM_BUCKETS = 8;
  const buckets = [];
  for (let b = 0; b < NUM_BUCKETS; b++) buckets.push([]);

  for (let i = 0; i < count; i++) {
    const fade = pfade[i];
    if (fade <= 0.01) continue;

    let alpha;
    if (pdetach[i]) {
      // Detached particles: alpha = fade value directly (no distance modulation)
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

  for (let b = 0; b < NUM_BUCKETS; b++) {
    const particles = buckets[b];
    if (particles.length === 0) continue;
    const a = (b + 0.5) / NUM_BUCKETS;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    for (let j = 0; j < particles.length; j++) {
      const idx = particles[j];
      ctx.fillRect(px[idx] * scaleX, py[idx] * scaleY, psize[idx] * scaleX, psize[idx] * scaleX);
    }
  }
}

// ── Entry points ────────────────────────────────────────────────────────────
export function renderFrame() {
  if (!shape) return;
  const { dctx } = getCanvasRefs();
  render(dctx, W, H);
}

export function renderToCanvas(targetCanvas, resMult, bgColor) {
  if (!shape) return;
  const ew = DW * resMult;
  const eh = DH * resMult;
  targetCanvas.width = ew;
  targetCanvas.height = eh;
  const ectx = targetCanvas.getContext('2d');
  if (bgColor === 'transparent') ectx.clearRect(0, 0, ew, eh);
  else { ectx.fillStyle = bgColor || 'black'; ectx.fillRect(0, 0, ew, eh); }
  render(ectx, ew, eh);
}

export function reinit() {
  if (!shape) return;
  const state = getState();
  init(shape, sdf, Math.round(500 + state.fillDensity * 4500));
}

export function getParticleShape() { return shape; }
export function getParticleSdf() { return sdf; }
