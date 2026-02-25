import { DW, DH, CX, CY } from '../utils/canvas.js';

// Represents a parsed shape with boundary points, tangents, and containment testing
export class Shape {
  constructor({ points, tangents, normals, pathLength, isPointInside, bounds }) {
    this.points = points;         // [{x, y}] sampled boundary points
    this.tangents = tangents;     // [{x, y}] unit tangent at each point
    this.normals = normals;       // [{x, y}] outward unit normal at each point
    this.pathLength = pathLength;
    this.isPointInside = isPointInside; // (x, y) => boolean
    this.bounds = bounds;         // {minX, minY, maxX, maxY}
    this.numPoints = points.length;
  }

  // Get nearest boundary point info for a pixel
  getNearestBoundary(x, y) {
    let minDist = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < this.numPoints; i++) {
      const p = this.points[i];
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }
    minDist = Math.sqrt(minDist);
    return {
      point: this.points[nearestIdx],
      tangent: this.tangents[nearestIdx],
      normal: this.normals[nearestIdx],
      distance: minDist,
      t: nearestIdx / this.numPoints, // parametric position 0-1
      index: nearestIdx,
    };
  }

  // Translate all boundary points by (dx, dy) and rebuild isPointInside
  translate(dx, dy) {
    for (let i = 0; i < this.numPoints; i++) {
      this.points[i].x += dx;
      this.points[i].y += dy;
    }
    this.bounds.minX += dx;
    this.bounds.minY += dy;
    this.bounds.maxX += dx;
    this.bounds.maxY += dy;
    this._rebuildIsPointInside();
  }

  // Scale all boundary points by factor around (cx, cy) and rebuild isPointInside
  scale(factor, cx, cy) {
    for (let i = 0; i < this.numPoints; i++) {
      this.points[i].x = cx + (this.points[i].x - cx) * factor;
      this.points[i].y = cy + (this.points[i].y - cy) * factor;
    }
    // Tangents and normals are unit vectors — uniform scale preserves direction
    this.bounds.minX = cx + (this.bounds.minX - cx) * factor;
    this.bounds.minY = cy + (this.bounds.minY - cy) * factor;
    this.bounds.maxX = cx + (this.bounds.maxX - cx) * factor;
    this.bounds.maxY = cy + (this.bounds.maxY - cy) * factor;
    // Fix bounds if factor < 0 flipped them
    if (this.bounds.minX > this.bounds.maxX) {
      const tmp = this.bounds.minX; this.bounds.minX = this.bounds.maxX; this.bounds.maxX = tmp;
    }
    if (this.bounds.minY > this.bounds.maxY) {
      const tmp = this.bounds.minY; this.bounds.minY = this.bounds.maxY; this.bounds.maxY = tmp;
    }
    this.pathLength *= Math.abs(factor);
    this._rebuildIsPointInside();
  }

  // Rotate all boundary points by angle (radians) around (cx, cy) and rebuild isPointInside
  rotate(angle, cx, cy) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.numPoints; i++) {
      const dx = this.points[i].x - cx, dy = this.points[i].y - cy;
      this.points[i].x = cx + dx * cos - dy * sin;
      this.points[i].y = cy + dx * sin + dy * cos;
      if (this.points[i].x < minX) minX = this.points[i].x;
      if (this.points[i].x > maxX) maxX = this.points[i].x;
      if (this.points[i].y < minY) minY = this.points[i].y;
      if (this.points[i].y > maxY) maxY = this.points[i].y;
      // Rotate tangents and normals
      const tx = this.tangents[i].x, ty = this.tangents[i].y;
      this.tangents[i].x = tx * cos - ty * sin;
      this.tangents[i].y = tx * sin + ty * cos;
      const nx = this.normals[i].x, ny = this.normals[i].y;
      this.normals[i].x = nx * cos - ny * sin;
      this.normals[i].y = nx * sin + ny * cos;
    }
    this.bounds = { minX, minY, maxX, maxY };
    this._rebuildIsPointInside();
  }

  // Rebuild isPointInside using a test canvas (shared by translate, scale, rotate)
  _rebuildIsPointInside() {
    const testCanvas = document.createElement('canvas');
    const w = Math.ceil(this.bounds.maxX + 50);
    const h = Math.ceil(this.bounds.maxY + 50);
    testCanvas.width = w;
    testCanvas.height = h;
    const ctx = testCanvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'white';
    ctx.beginPath();
    for (let i = 0; i < this.numPoints; i++) {
      const p = this.points[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;
    const tw = w;
    this.isPointInside = (x, y) => {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || px >= tw || py < 0 || py >= h) return false;
      return pixels[(py * tw + px) * 4] > 128;
    };
  }

  // Deep clone this shape (for undo snapshots)
  clone() {
    const pts = this.points.map(p => ({ x: p.x, y: p.y }));
    const tans = this.tangents.map(t => ({ x: t.x, y: t.y }));
    const norms = this.normals.map(n => ({ x: n.x, y: n.y }));
    const cloned = new Shape({
      points: pts,
      tangents: tans,
      normals: norms,
      pathLength: this.pathLength,
      isPointInside: this.isPointInside, // closure over pixel data, safe to share
      bounds: { ...this.bounds },
    });
    return cloned;
  }

  // Get position at parametric t (0-1) along boundary
  getPointAtT(t) {
    t = ((t % 1) + 1) % 1;
    const idx = Math.round(t * this.numPoints) % this.numPoints;
    return {
      point: this.points[idx],
      tangent: this.tangents[idx],
      normal: this.normals[idx],
      index: idx,
    };
  }
}

// Create a circle shape (default)
export function createCircleShape(radius) {
  radius = radius || DH * 0.18;
  const numSamples = 360;
  const points = [];
  const tangents = [];
  const normals = [];

  for (let i = 0; i < numSamples; i++) {
    const a = (i / numSamples) * Math.PI * 2;
    points.push({ x: CX + Math.cos(a) * radius, y: CY + Math.sin(a) * radius });
    // Tangent is perpendicular to radius (CCW)
    tangents.push({ x: -Math.sin(a), y: Math.cos(a) });
    // Normal points outward
    normals.push({ x: Math.cos(a), y: Math.sin(a) });
  }

  const isPointInside = (x, y) => {
    const dx = x - CX, dy = y - CY;
    return dx * dx + dy * dy < radius * radius;
  };

  return new Shape({
    points,
    tangents,
    normals,
    pathLength: 2 * Math.PI * radius,
    isPointInside,
    bounds: { minX: CX - radius, minY: CY - radius, maxX: CX + radius, maxY: CY + radius },
  });
}

// Parse an SVG string into a Shape
export function parseSVG(svgString) {
  // Parse SVG using DOMParser
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('Invalid SVG: no <svg> element found');

  // Get viewBox or dimensions
  let vbW, vbH;
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    vbW = parts[2];
    vbH = parts[3];
  } else {
    vbW = parseFloat(svg.getAttribute('width')) || 100;
    vbH = parseFloat(svg.getAttribute('height')) || 100;
  }

  // Create an off-screen SVG to leverage browser path API
  const offSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  offSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  offSvg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
  offSvg.style.position = 'absolute';
  offSvg.style.left = '-9999px';
  offSvg.style.width = vbW + 'px';
  offSvg.style.height = vbH + 'px';
  document.body.appendChild(offSvg);

  // Collect all shape elements and convert to paths
  const pathElements = [];
  const shapeSelectors = 'path, circle, ellipse, rect, polygon, polyline, line';
  const elements = svg.querySelectorAll(shapeSelectors);

  for (const el of elements) {
    const pathEl = convertToPath(el, offSvg);
    if (pathEl) pathElements.push(pathEl);
  }

  if (pathElements.length === 0) {
    document.body.removeChild(offSvg);
    throw new Error('No shape elements found in SVG');
  }

  // Combine all paths and sample points
  const allPoints = [];
  const allTangents = [];
  const allNormals = [];
  let totalLength = 0;

  for (const pathEl of pathElements) {
    offSvg.appendChild(pathEl);
    const len = pathEl.getTotalLength();
    totalLength += len;
  }

  // Calculate scale/offset to fit shape in dither canvas
  // First pass: find bounds
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const pathEl of pathElements) {
    const len = pathEl.getTotalLength();
    const steps = Math.max(20, Math.round(len / 2));
    for (let i = 0; i <= steps; i++) {
      const pt = pathEl.getPointAtLength((i / steps) * len);
      bMinX = Math.min(bMinX, pt.x);
      bMinY = Math.min(bMinY, pt.y);
      bMaxX = Math.max(bMaxX, pt.x);
      bMaxY = Math.max(bMaxY, pt.y);
    }
  }

  const svgW = bMaxX - bMinX;
  const svgH = bMaxY - bMinY;
  const maxDim = DH * 0.36; // shape occupies ~36% of canvas height
  const fitScale = Math.min(maxDim / svgW, maxDim / svgH);
  const offX = CX - (bMinX + svgW / 2) * fitScale;
  const offY = CY - (bMinY + svgH / 2) * fitScale;

  // Second pass: sample boundary points at regular intervals
  const numSamples = Math.max(360, Math.round(totalLength * fitScale / 1.5));

  for (const pathEl of pathElements) {
    const len = pathEl.getTotalLength();
    const pathSamples = Math.round((len / totalLength) * numSamples);

    for (let i = 0; i < pathSamples; i++) {
      const d = (i / pathSamples) * len;
      const pt = pathEl.getPointAtLength(d);
      const x = pt.x * fitScale + offX;
      const y = pt.y * fitScale + offY;

      // Compute tangent via finite difference
      const delta = 0.5;
      const ptA = pathEl.getPointAtLength(Math.max(0, d - delta));
      const ptB = pathEl.getPointAtLength(Math.min(len, d + delta));
      let tx = (ptB.x - ptA.x) * fitScale;
      let ty = (ptB.y - ptA.y) * fitScale;
      const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tLen;
      ty /= tLen;

      allPoints.push({ x, y });
      allTangents.push({ x: tx, y: ty });
      // Normal is perpendicular to tangent (pointing right/outward)
      allNormals.push({ x: ty, y: -tx });
    }
  }

  // Create off-screen canvas for point-in-shape testing
  const testCanvas = document.createElement('canvas');
  testCanvas.width = DW;
  testCanvas.height = DH;
  const testCtx = testCanvas.getContext('2d');

  // Draw shape filled on test canvas
  testCtx.clearRect(0, 0, DW, DH);
  testCtx.fillStyle = 'black';
  testCtx.fillRect(0, 0, DW, DH);
  testCtx.fillStyle = 'white';
  testCtx.beginPath();
  for (const pathEl of pathElements) {
    const len = pathEl.getTotalLength();
    const steps = Math.max(100, Math.round(len * fitScale / 2));
    for (let i = 0; i <= steps; i++) {
      const pt = pathEl.getPointAtLength((i / steps) * len);
      const x = pt.x * fitScale + offX;
      const y = pt.y * fitScale + offY;
      if (i === 0) testCtx.moveTo(x, y);
      else testCtx.lineTo(x, y);
    }
    testCtx.closePath();
  }
  testCtx.fill();

  const testImageData = testCtx.getImageData(0, 0, DW, DH);
  const testPixels = testImageData.data;

  const isPointInside = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || px >= DW || py < 0 || py >= DH) return false;
    return testPixels[(py * DW + px) * 4] > 128;
  };

  // Fix normals to point outward
  // Test a point slightly along each normal — if it's inside, flip the normal
  for (let i = 0; i < allPoints.length; i++) {
    const p = allPoints[i];
    const n = allNormals[i];
    const testX = p.x + n.x * 3;
    const testY = p.y + n.y * 3;
    if (isPointInside(testX, testY)) {
      allNormals[i] = { x: -n.x, y: -n.y };
    }
  }

  document.body.removeChild(offSvg);

  const scaledBounds = {
    minX: bMinX * fitScale + offX,
    minY: bMinY * fitScale + offY,
    maxX: bMaxX * fitScale + offX,
    maxY: bMaxY * fitScale + offY,
  };

  return new Shape({
    points: allPoints,
    tangents: allTangents,
    normals: allNormals,
    pathLength: totalLength * fitScale,
    isPointInside,
    bounds: scaledBounds,
  });
}

// Convert SVG shape elements to <path> elements
function convertToPath(el, parentSvg) {
  const tag = el.tagName.toLowerCase();
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  // Copy transform attribute if present
  const transform = el.getAttribute('transform');
  if (transform) path.setAttribute('transform', transform);

  switch (tag) {
    case 'path': {
      const d = el.getAttribute('d');
      if (!d) return null;
      path.setAttribute('d', d);
      return path;
    }
    case 'circle': {
      const cx = parseFloat(el.getAttribute('cx')) || 0;
      const cy = parseFloat(el.getAttribute('cy')) || 0;
      const r = parseFloat(el.getAttribute('r')) || 0;
      if (r <= 0) return null;
      path.setAttribute('d',
        `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy}Z`);
      return path;
    }
    case 'ellipse': {
      const cx = parseFloat(el.getAttribute('cx')) || 0;
      const cy = parseFloat(el.getAttribute('cy')) || 0;
      const rx = parseFloat(el.getAttribute('rx')) || 0;
      const ry = parseFloat(el.getAttribute('ry')) || 0;
      if (rx <= 0 || ry <= 0) return null;
      path.setAttribute('d',
        `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy}Z`);
      return path;
    }
    case 'rect': {
      const x = parseFloat(el.getAttribute('x')) || 0;
      const y = parseFloat(el.getAttribute('y')) || 0;
      const w = parseFloat(el.getAttribute('width')) || 0;
      const h = parseFloat(el.getAttribute('height')) || 0;
      if (w <= 0 || h <= 0) return null;
      const rx = Math.min(parseFloat(el.getAttribute('rx')) || 0, w / 2);
      const ry = Math.min(parseFloat(el.getAttribute('ry')) || rx, h / 2);
      if (rx > 0 && ry > 0) {
        path.setAttribute('d',
          `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0,1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0,1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0,1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0,1 ${x + rx},${y}Z`);
      } else {
        path.setAttribute('d', `M${x},${y} H${x + w} V${y + h} H${x} Z`);
      }
      return path;
    }
    case 'polygon':
    case 'polyline': {
      const pts = el.getAttribute('points');
      if (!pts) return null;
      const coords = pts.trim().split(/[\s,]+/).map(Number);
      if (coords.length < 4) return null;
      let d = `M${coords[0]},${coords[1]}`;
      for (let i = 2; i < coords.length; i += 2) {
        d += ` L${coords[i]},${coords[i + 1]}`;
      }
      if (tag === 'polygon') d += 'Z';
      path.setAttribute('d', d);
      return path;
    }
    case 'line': {
      const x1 = parseFloat(el.getAttribute('x1')) || 0;
      const y1 = parseFloat(el.getAttribute('y1')) || 0;
      const x2 = parseFloat(el.getAttribute('x2')) || 0;
      const y2 = parseFloat(el.getAttribute('y2')) || 0;
      path.setAttribute('d', `M${x1},${y1} L${x2},${y2}`);
      return path;
    }
    default:
      return null;
  }
}
