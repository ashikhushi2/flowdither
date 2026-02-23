import { DW, DH } from '../utils/canvas.js';

// Signed Distance Field computed from a Shape
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
    const shape = this.shape;
    this.grid = new Float32Array(w * h);
    this.nearestIdx = new Int32Array(w * h);

    const points = shape.points;
    const numPts = points.length;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let minDist = Infinity;
        let bestIdx = 0;

        // Find nearest boundary point
        for (let i = 0; i < numPts; i++) {
          const p = points[i];
          const dx = p.x - x;
          const dy = p.y - y;
          const d = dx * dx + dy * dy;
          if (d < minDist) {
            minDist = d;
            bestIdx = i;
          }
        }

        minDist = Math.sqrt(minDist);

        // Sign: negative inside, positive outside
        const inside = shape.isPointInside(x, y);
        const signedDist = inside ? -minDist : minDist;

        const idx = y * w + x;
        this.grid[idx] = signedDist;
        this.nearestIdx[idx] = bestIdx;
      }
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
