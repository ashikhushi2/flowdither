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

// [CENTER-MODE] Helper: reset particle fields to defaults
function resetParticleFields(i) {
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

// [CENTER-MODE] Spawn particle near shape boundary (for inward flow)
function spawnAtBoundary(i) {
  const idx = Math.floor(Math.random() * shape.numPoints);
  const bp = shape.points[idx];
  const norm = shape.normals[idx];
  // Slightly inside the boundary (inset by 2-6px along inward normal)
  const inset = 2 + Math.random() * 4;
  px[i] = bp.x - norm.x * inset;
  py[i] = bp.y - norm.y * inset;
  resetParticleFields(i);
  // pfade set to 1 (full) — distance-based fade in update() handles visibility
}

function spawnParticle(i) {
  const b = shape.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const state = getState();
  const isSpiralCenter = state.flowCategory === 'spiral' && state.spiralMode === 'center';
  const isRadial = state.flowCategory === 'radial';

  // [RADIAL / SPIRAL-CENTER] Spawn across entire area — velocity field creates density gradient
  if (isSpiralCenter || isRadial) {
    spawnAtRandomRadius(i);
    return;
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const x = b.minX + Math.random() * w;
    const y = b.minY + Math.random() * h;
    if (shape.isPointInside(x, y)) {
      px[i] = x;  py[i] = y;
      resetParticleFields(i);
      return;
    }
  }

  const idx = Math.floor(Math.random() * shape.numPoints);
  px[i] = shape.points[idx].x;
  py[i] = shape.points[idx].y;
  resetParticleFields(i);
}

// [CENTER/RADIAL MODES] Spawn particle randomly inside the actual shape geometry
function spawnAtRandomRadius(i) {
  const b = shape.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  // Try random points inside the shape — works for any shape including SVGs
  for (let attempt = 0; attempt < 100; attempt++) {
    const x = b.minX + Math.random() * w;
    const y = b.minY + Math.random() * h;
    if (shape.isPointInside(x, y)) {
      px[i] = x;
      py[i] = y;
      resetParticleFields(i);
      return;
    }
  }
  // Fallback: spawn at a boundary point
  const idx = Math.floor(Math.random() * shape.numPoints);
  px[i] = shape.points[idx].x;
  py[i] = shape.points[idx].y;
  resetParticleFields(i);
}

// ── Init ────────────────────────────────────────────────────────────────────
export function init(newShape, newSdf, particleCount) {
  shape = newShape;
  sdf = newSdf;
  count = Math.min(particleCount, MAX_PARTICLES);

  const state = getState();
  const isSpiralCenter = state.flowCategory === 'spiral' && state.spiralMode === 'center';
  const isRadial = state.flowCategory === 'radial';

  for (let i = 0; i < count; i++) {
    if (isSpiralCenter || isRadial) {
      // Pre-fill entire radius — steady-state, no empty regions
      spawnAtRandomRadius(i);
    } else {
      spawnParticle(i);
    }
    plife[i] = Math.random() * pmaxLife[i];
  }
}

// ── Update ──────────────────────────────────────────────────────────────────
export function update(dt) {
  if (!shape || !sdf || count === 0) return;

  const state = getState();
  const { nodes, flowDir, speedMult, grainSpace, flowCategory, radialMode, currentShape } = state;

  const baseSpeed = 30 * speedMult;
  const gravityK = 0.3;
  const isRadial = flowCategory === 'radial';
  const radialCenter = isRadial && radialMode === 'center';   // radial inward to center
  const radialEdgeMode = isRadial && radialMode === 'edge';   // radial outward to edge
  const spiralCenter = flowCategory === 'spiral' && state.spiralMode === 'center'; // spiral inward to center

  // Shape center + radius for radial modes
  let shapeCX = 0, shapeCY = 0, shapeR = 1;
  if (currentShape) {
    const b = currentShape.bounds;
    shapeCX = (b.minX + b.maxX) / 2 + (state.centerOffsetX || 0);
    shapeCY = (b.minY + b.maxY) / 2 + (state.centerOffsetY || 0);
    shapeR = Math.max((b.maxX - b.minX), (b.maxY - b.minY)) / 2 || 1;
  }
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

    // 2. Path tangent flow + 3. Gravity
    // SDF-based normalized radius: works for ANY shape (circles, ellipses, SVGs, polygons)
    // r = cdist / (cdist + |sdfDist|) → 0 at center, 1 at boundary
    if (radialEdgeMode) {
      // ── [RADIAL-EDGE] Radial outward flow — exact mirror of radial-center ──
      const fromCX = x - shapeCX, fromCY = y - shapeCY;
      const cdist = Math.sqrt(fromCX * fromCX + fromCY * fromCY) || 0.01;
      const sd = sdf.sample(x, y);
      const absSd = Math.abs(sd);
      const normalizedDist = Math.min(cdist / (cdist + absSd + 0.01), 1);

      // Outward push with speed floor: fast at center, slow at edge
      const edgeDist = 1 - normalizedDist; // 1=center, 0=edge
      const speedScale = (0.35 + 0.65 * edgeDist) * baseSpeed * 1.2;
      const radX = fromCX / cdist, radY = fromCY / cdist;
      const vx_radial = radX * speedScale;
      const vy_radial = radY * speedScale;

      // Tangential swirl (perpendicular, decreases near edge)
      const orbX = -radY * flowDir, orbY = radX * flowDir;
      const swirlStrength = edgeDist * edgeDist * baseSpeed * 0.3;
      const vx_swirl = orbX * swirlStrength;
      const vy_swirl = orbY * swirlStrength;

      // Blend: radial push dominates, swirl secondary
      vx = vx_radial * 0.85 + vx_swirl * 0.15;
      vy = vy_radial * 0.85 + vy_swirl * 0.15;

      // Opacity: full at center, fades near edge
      pfade[i] = Math.min(1, edgeDist * 1.5);

    } else if (radialCenter) {
      // ── [RADIAL-CENTER] Radial inward flow ──
      const toCX = shapeCX - x, toCY = shapeCY - y;
      const cdist = Math.sqrt(toCX * toCX + toCY * toCY) || 0.01;
      const sd = sdf.sample(x, y);
      const absSd = Math.abs(sd);
      const normalizedDist = Math.min(cdist / (cdist + absSd + 0.01), 1);

      // Inward pull with speed floor
      const speedScale = (0.35 + 0.65 * normalizedDist) * baseSpeed * 1.2;
      const radX = toCX / cdist, radY = toCY / cdist;
      const vx_radial = radX * speedScale;
      const vy_radial = radY * speedScale;

      // Tangential swirl (perpendicular to radial, decreases near center)
      const orbX = -radY * flowDir, orbY = radX * flowDir;
      const swirlStrength = normalizedDist * normalizedDist * baseSpeed * 0.3;
      const vx_swirl = orbX * swirlStrength;
      const vy_swirl = orbY * swirlStrength;

      // Blend: radial pull dominates, swirl secondary
      vx = vx_radial * 0.85 + vx_swirl * 0.15;
      vy = vy_radial * 0.85 + vy_swirl * 0.15;

      // Opacity: full at edge, fades near center
      pfade[i] = Math.min(1, normalizedDist * 1.5);

    } else if (spiralCenter) {
      // ── [SPIRAL-CENTER] Pure velocity field — no forces, no accumulation ──
      // Velocity is computed directly from position each frame.

      // Step 1: direction to center + SDF-based normalized radius (works for any shape)
      const toCX = shapeCX - x, toCY = shapeCY - y;
      const cdist = Math.sqrt(toCX * toCX + toCY * toCY) || 0.01;
      const sd = sdf.sample(x, y);
      const absSd = Math.abs(sd);
      const r = Math.min(cdist / (cdist + absSd + 0.01), 1); // 0=center, 1=edge
      const inX = toCX / cdist, inY = toCY / cdist; // unit inward

      // Step 2: tangent = perpendicular of inward vector
      const tanX = -inY * flowDir, tanY = inX * flowDir;

      // Step 3: blend — at edge mostly orbit, at center mostly inward
      const blendX = tanX * r + inX * (1 - r);
      const blendY = tanY * r + inY * (1 - r);

      // Step 4: normalize direction
      const blen = Math.sqrt(blendX * blendX + blendY * blendY) || 1;
      const dirX = blendX / blen, dirY = blendY / blen;

      // Step 5: speed falloff — fast at edge, slow at center
      // Floor of 0.35 prevents near-zero speed at center (avoids extreme accumulation)
      const speed = baseSpeed * (0.35 + 0.65 * r);

      // Step 6: set velocity directly (no accumulation)
      vx = dirX * speed;
      vy = dirY * speed;

      // Opacity: full at edge, fades near center
      pfade[i] = Math.min(1, r * 1.5);

    } else {
      // ── Spiral edge (default): tangent + gravity + nodes ──
      const info = sdf.getNearestBoundaryInfo(x, y);
      const tangent = info.tangent;
      const nearest = info.point;
      const dist = info.distance;

      vx = tangent.x * baseSpeed * flowDir;
      vy = tangent.y * baseSpeed * flowDir;

      const gx = nearest.x - x;
      const gy = nearest.y - y;
      // Original boundary gravity — creates the outward spiral drift
      const gStrength = gravityK * Math.min(dist * 0.05, 1.0);
      vx += gx * gStrength;
      vy += gy * gStrength;

      // Center offset bias — shift spiral focus toward offset center
      if (state.centerOffsetX || state.centerOffsetY) {
        const toCX = shapeCX - x, toCY = shapeCY - y;
        const cDist = Math.sqrt(toCX * toCX + toCY * toCY) || 1;
        // Orbit around offset center: tangential component (perpendicular to radial)
        const radX = toCX / cDist, radY = toCY / cDist;
        const orbX = -radY * flowDir, orbY = radX * flowDir;
        // Offset magnitude drives blend strength
        const offMag = Math.sqrt(state.centerOffsetX * state.centerOffsetX + state.centerOffsetY * state.centerOffsetY);
        const blend = Math.min(offMag / 150, 0.7); // ramps up to 0.7 at 150px offset
        // Blend: replace some boundary-tangent flow with orbit around offset center
        vx = vx * (1 - blend) + orbX * baseSpeed * blend;
        vy = vy * (1 - blend) + orbY * baseSpeed * blend;
        // Radial pull toward offset center (maintains spiral structure)
        const pullStrength = gravityK * blend * Math.min(dist * 0.05, 1.0);
        vx += radX * pullStrength * cDist * 0.02;
        vy += radY * pullStrength * cDist * 0.02;
      }
    }

    // 4. Flow stream node influence
    if (radialCenter || radialEdgeMode || spiralCenter) {
      // [RADIAL/CENTER MODES] Nodes add tangential swirl only — no detachment, no escape
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

        // [RADIAL-CENTER] Add tangential swirl from node handle direction
        const curSpeed = Math.sqrt(vx * vx + vy * vy) || 1;
        const hcos = Math.cos(n.handleAngle);
        const hsin = Math.sin(n.handleAngle);
        const swirlAmt = influence * n.directionStrength * 0.3;
        vx += (hcos * curSpeed - vx) * swirlAmt;
        vy += (hsin * curSpeed - vy) * swirlAmt;
        const ns = Math.sqrt(vx * vx + vy * vy) || 1;
        vx = vx / ns * curSpeed;
        vy = vy / ns * curSpeed;
      }
    } else {
      // ── Spiral/radial edge: full node influence with detachment ──
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
    }

    // Decay escape influence when outside all node radii
    if (esc < 0.01) {
      esc = 0;
    }
    pescInf[i] = esc;

    // Life drain — skip for radial/center modes (lifetime is distance-driven, not time-driven)
    if (!spiralCenter && !radialCenter && !radialEdgeMode) {
      plife[i] -= 1;
    }

    // Grain noise
    vx += (Math.random() - 0.5) * grainAmp * baseSpeed * 0.2;
    vy += (Math.random() - 0.5) * grainAmp * baseSpeed * 0.2;

    // Move
    px[i] = x + vx * dt;
    py[i] = y + vy * dt;

    // Respawn
    const newX = px[i];
    const newY = py[i];

    if (spiralCenter || radialCenter) {
      // [CENTER MODES] SDF-based death — use normalized radius for any shape
      const toCX = newX - shapeCX, toCY = newY - shapeCY;
      const cdist = Math.sqrt(toCX * toCX + toCY * toCY);
      const sd = sdf.sample(newX, newY);
      const absSd = Math.abs(sd);
      const rNorm = cdist / (cdist + absSd + 0.01);
      const atCenter = rNorm < 0.05; // ~5% normalized radius
      const outsideShape = sd > 0; // particle left the shape boundary
      const offCanvas = newX < -80 || newX >= DW + 80 || newY < -80 || newY >= DH + 80;
      if (atCenter || outsideShape || offCanvas) {
        spawnParticle(i);
      }
    } else if (radialEdgeMode) {
      // [RADIAL-EDGE] SDF-based death — particles die near the boundary
      const sd = sdf.sample(newX, newY);
      const nearEdge = sd > -3; // within 3px of boundary (or outside)
      const offCanvas = newX < -80 || newX >= DW + 80 || newY < -80 || newY >= DH + 80;
      if (nearEdge || offCanvas) {
        spawnParticle(i);
      }
    } else {
      // Spiral-edge: original respawn logic + near-boundary thinning
      const offCanvas = newX < -80 || newX >= DW + 80 || newY < -80 || newY >= DH + 80;
      const sd = sdf.sample(newX, newY);
      const outsideShape = sd > 0;
      if (offCanvas || plife[i] <= 0 || (outsideShape && esc < 0.1)) {
        spawnParticle(i);
      } else if (!pdetach[i] && sd < 0 && Math.abs(sd) < 8) {
        // Near boundary (within 8px inside): 2% chance per frame to respawn
        // Prevents edge pile-up by recycling some particles before they accumulate
        if (Math.random() < 0.02) {
          spawnParticle(i);
        }
      }
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
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r: isNaN(r) ? 255 : r, g: isNaN(g) ? 255 : g, b: isNaN(b) ? 255 : b };
}

function drawParticles(ctx, w, h) {
  const NUM_BUCKETS = 8;
  const buckets = [];
  for (let b = 0; b < NUM_BUCKETS; b++) buckets.push([]);

  // Determine draw alpha mode per flow category + mode
  const drawState = getState();
  const isCenterDraw = (drawState.flowCategory === 'radial' && drawState.radialMode === 'center')
                    || (drawState.flowCategory === 'spiral' && drawState.spiralMode === 'center');
  const isEdgeDraw = (drawState.flowCategory === 'radial' && drawState.radialMode === 'edge')
                  || (drawState.flowCategory === 'spiral' && drawState.spiralMode === 'edge');

  // Shape center + radius for radial alpha gradient
  let dShapeCX = 0, dShapeCY = 0, dShapeR = 1;
  if (shape) {
    const sb = shape.bounds;
    dShapeCX = (sb.minX + sb.maxX) / 2 + (drawState.centerOffsetX || 0);
    dShapeCY = (sb.minY + sb.maxY) / 2 + (drawState.centerOffsetY || 0);
    dShapeR = Math.max(sb.maxX - sb.minX, sb.maxY - sb.minY) / 2 || 1;
  }

  for (let i = 0; i < count; i++) {
    const fade = pfade[i];
    if (fade <= 0.01) continue;

    let alpha;
    if (pdetach[i]) {
      alpha = 0.6 * fade;
    } else if (isCenterDraw) {
      // [CENTER MODES] SDF-based gradient: bright at center, dim at edge
      const dxC = px[i] - dShapeCX, dyC = py[i] - dShapeCY;
      const rDist = Math.sqrt(dxC * dxC + dyC * dyC);
      const sd = sdf.sample(px[i], py[i]);
      const absSd = Math.abs(sd);
      const rNorm = Math.min(rDist / (rDist + absSd + 0.01), 1);
      alpha = (0.1 + 0.9 * (1 - rNorm)) * fade;
    } else if (isEdgeDraw) {
      // [EDGE MODES] SDF-based gradient: dim at center, bright at edge
      const dxC = px[i] - dShapeCX, dyC = py[i] - dShapeCY;
      const rDist = Math.sqrt(dxC * dxC + dyC * dyC);
      const sd = sdf.sample(px[i], py[i]);
      const absSd = Math.abs(sd);
      const rNorm = Math.min(rDist / (rDist + absSd + 0.01), 1);
      alpha = (0.1 + 0.9 * rNorm) * fade;
    } else {
      // Default (no special gradient)
      alpha = fade;
    }

    const bucket = Math.min(NUM_BUCKETS - 1, Math.floor(alpha * NUM_BUCKETS));
    buckets[bucket].push(i);
  }

  const scaleX = w / DW;
  const scaleY = h / DH;

  const state = getState();
  const { r, g, b: bl } = parseHexColor(state.particleColor || '#ffffff');
  const shapeOpacity = state.opacity != null ? state.opacity : 1;

  for (let b = 0; b < NUM_BUCKETS; b++) {
    const particles = buckets[b];
    if (particles.length === 0) continue;
    const a = (b + 0.5) / NUM_BUCKETS * shapeOpacity;
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

// Non-uniform scale all particle positions by (fx, fy) around (cx, cy) and update shape/sdf references
export function scaleParticlesXY(fx, fy, cx, cy, newShape, newSdf) {
  shape = newShape;
  sdf = newSdf;
  for (let i = 0; i < count; i++) {
    px[i] = cx + (px[i] - cx) * fx;
    py[i] = cy + (py[i] - cy) * fy;
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
