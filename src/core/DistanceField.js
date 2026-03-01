import { DW, DH } from '../utils/canvas.js';

// Signed Distance Field computed from a Shape using Jump Flood Algorithm
// O(W*H*log(max(W,H))) instead of brute-force O(W*H*N)
export class DistanceField {
  constructor(shape) {
    this.shape = shape;
    this.width = DW;
    this.height = DH;
    this.grid = null;
    this.nearestIdx = null; // index into shape.points for each pixel
  }

  compute() {
    const w = this.width;
    const h = this.height;
    const size = w * h;
    const shape = this.shape;
    const points = shape.points;
    const numPts = points.length;

    // ── 1. Seed: rasterize boundary points into the grid ──
    // nearestIdx[pixel] = index of nearest boundary point (-1 = unset)
    const nearest = new Int32Array(size).fill(-1);

    // Pre-extract boundary points into flat arrays for speed
    const bx = new Float32Array(numPts);
    const by = new Float32Array(numPts);
    for (let i = 0; i < numPts; i++) {
      bx[i] = points[i].x;
      by[i] = points[i].y;
    }

    // Seed: for each boundary point, mark its nearest pixel
    for (let i = 0; i < numPts; i++) {
      const px = Math.round(bx[i]);
      const py = Math.round(by[i]);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const idx = py * w + px;
      if (nearest[idx] === -1) {
        nearest[idx] = i;
      } else {
        // If multiple points map to same pixel, keep the one — JFA will sort it out
        nearest[idx] = i;
      }
    }

    // ── 2. Jump Flood Algorithm ──
    // For each pass with step size k, check 8 neighbors + self at distance k
    const maxDim = Math.max(w, h);
    // Start step at next power of 2 >= maxDim/2
    let step = 1;
    while (step < maxDim) step <<= 1;
    step >>= 1;

    // Two buffers to ping-pong
    const nearestB = new Int32Array(size).fill(-1);
    let src = nearest;
    let dst = nearestB;

    while (step >= 1) {
      // Copy src to dst first (self-check)
      dst.set(src);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          let bestIdx = src[idx];
          let bestDist = Infinity;

          if (bestIdx >= 0) {
            const dx = bx[bestIdx] - x;
            const dy = by[bestIdx] - y;
            bestDist = dx * dx + dy * dy;
          }

          // Check 8 neighbors at step distance
          for (let dy = -step; dy <= step; dy += step) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -step; dx <= step; dx += step) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              if (nx < 0 || nx >= w) continue;
              const nidx = ny * w + nx;
              const candidateIdx = src[nidx];
              if (candidateIdx < 0) continue;

              const cdx = bx[candidateIdx] - x;
              const cdy = by[candidateIdx] - y;
              const cd = cdx * cdx + cdy * cdy;
              if (cd < bestDist) {
                bestDist = cd;
                bestIdx = candidateIdx;
              }
            }
          }

          dst[idx] = bestIdx;
        }
      }

      // Swap buffers
      const tmp = src;
      src = dst;
      dst = tmp;
      step >>= 1;
    }

    // Result is in src
    this.nearestIdx = src;

    // ── 3. Pre-compute inside/outside bitmap via scanline ray-casting ──
    // Much faster than per-pixel raycast: O(H * N) instead of O(W * H * N)
    const insideBits = new Uint8Array(size);
    const pts = shape.points;
    const n = pts.length;
    for (let y = 0; y < h; y++) {
      // Collect all edge crossings for this scanline
      const crossings = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = pts[i].y, yj = pts[j].y;
        if ((yi > y) !== (yj > y)) {
          const xCross = (pts[j].x - pts[i].x) * (y - yi) / (yj - yi) + pts[i].x;
          crossings.push(xCross);
        }
      }
      crossings.sort((a, b) => a - b);
      // Fill between pairs of crossings (even-odd rule)
      for (let c = 0; c < crossings.length - 1; c += 2) {
        const x0 = Math.max(0, Math.ceil(crossings[c]));
        const x1 = Math.min(w - 1, Math.floor(crossings[c + 1]));
        const rowBase = y * w;
        for (let x = x0; x <= x1; x++) {
          insideBits[rowBase + x] = 1;
        }
      }
    }

    // ── 4. Compute signed distances ──
    this.grid = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const bi = src[i];
      let dist;
      if (bi >= 0) {
        const px = i % w, py = (i / w) | 0;
        const dx = bx[bi] - px;
        const dy = by[bi] - py;
        dist = Math.sqrt(dx * dx + dy * dy);
      } else {
        dist = maxDim;
      }
      this.grid[i] = insideBits[i] ? -dist : dist;
    }
  }

  // Get SDF value at pixel (with bounds check)
  sample(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) {
      // Outside canvas — estimate based on distance to bounds center
      return Math.max(this.width, this.height);
    }
    return this.grid[iy * this.width + ix];
  }

  // Get SDF with bilinear interpolation
  sampleSmooth(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const s00 = this.sample(ix, iy);
    const s10 = this.sample(ix + 1, iy);
    const s01 = this.sample(ix, iy + 1);
    const s11 = this.sample(ix + 1, iy + 1);

    return s00 * (1 - fx) * (1 - fy) +
           s10 * fx * (1 - fy) +
           s01 * (1 - fx) * fy +
           s11 * fx * fy;
  }

  // Get nearest boundary point index for a pixel
  getNearestIndex(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return 0;
    return this.nearestIdx[iy * this.width + ix];
  }

  // Shallow clone with a new shape reference (shares grid/nearestIdx data)
  clone(newShape) {
    const cloned = new DistanceField(newShape || this.shape);
    cloned.width = this.width;
    cloned.height = this.height;
    cloned.grid = this.grid;           // share — immutable after compute()
    cloned.nearestIdx = this.nearestIdx; // share
    return cloned;
  }

  // Get full boundary info for a pixel
  getNearestBoundaryInfo(x, y) {
    const idx = this.getNearestIndex(x, y);
    const shape = this.shape;
    return {
      point: shape.points[idx],
      tangent: shape.tangents[idx],
      normal: shape.normals[idx],
      distance: Math.abs(this.sample(x, y)),
      signedDistance: this.sample(x, y),
      t: idx / shape.numPoints,
      index: idx,
    };
  }
}
