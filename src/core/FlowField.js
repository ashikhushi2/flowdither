import { CX, CY } from '../utils/canvas.js';
import { normA, angDiff } from '../utils/math.js';
import { getState } from '../nodes/NodeManager.js';

// Base flow direction depending on mode
export function baseFlow(angle, flowMode, flowDir, linearAng) {
  if (flowMode === 'tangential') {
    return { fx: -Math.sin(angle) * flowDir, fy: Math.cos(angle) * flowDir };
  } else if (flowMode === 'radial') {
    return { fx: Math.cos(angle) * flowDir, fy: Math.sin(angle) * flowDir };
  } else {
    return { fx: Math.cos(linearAng), fy: Math.sin(linearAng) };
  }
}

// Compute flow vector for circle shape (original algorithm)
export function getFlowCircle(px, py) {
  const state = getState();
  const { nodes, flowMode, flowDir, linearAng } = state;

  const dx = px - CX, dy = py - CY;
  const pixAng = Math.atan2(dy, dx);

  const base = baseFlow(pixAng, flowMode, flowDir, linearAng);
  let fx = base.fx, fy = base.fy;
  let totalW = 0;
  let ndx = 0, ndy = 0;

  for (const n of nodes) {
    const ad = angDiff(pixAng, n.angle);
    if (ad >= n.spread) continue;

    const w = Math.cos((ad / n.spread) * Math.PI * 0.5) ** 2;
    ndx += Math.cos(n.handleAngle) * w;
    ndy += Math.sin(n.handleAngle) * w;
    totalW += w;
  }

  if (totalW > 0.001) {
    const blend = Math.min(1, totalW);
    const nl = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
    fx = fx * (1 - blend) + (ndx / nl) * blend;
    fy = fy * (1 - blend) + (ndy / nl) * blend;
  }

  const len = Math.sqrt(fx * fx + fy * fy) || 1;
  return [fx / len, fy / len];
}

// Compute flow vector for arbitrary shapes using SDF/boundary info
export function getFlowSDF(px, py, sdf) {
  const state = getState();
  const { nodes, flowMode, flowDir, linearAng } = state;
  const shape = sdf.shape;

  const info = sdf.getNearestBoundaryInfo(px, py);
  const { tangent, normal, t: pixT } = info;

  // Base flow: use boundary tangent/normal instead of polar angle
  let fx, fy;
  if (flowMode === 'tangential') {
    fx = tangent.x * flowDir;
    fy = tangent.y * flowDir;
  } else if (flowMode === 'radial') {
    // Radial = outward along normal
    fx = normal.x * flowDir;
    fy = normal.y * flowDir;
  } else {
    fx = Math.cos(linearAng);
    fy = Math.sin(linearAng);
  }

  // Node influence using parametric distance along boundary
  let totalW = 0;
  let ndx = 0, ndy = 0;

  for (const n of nodes) {
    // Parametric distance along boundary (wrapping)
    let dt = Math.abs(pixT - n.t);
    if (dt > 0.5) dt = 1 - dt;

    // Convert spread from radians to parametric (spread of pi = half the boundary)
    const spreadT = n.spread / (Math.PI * 2);
    if (dt >= spreadT) continue;

    const w = Math.cos((dt / spreadT) * Math.PI * 0.5) ** 2;
    ndx += Math.cos(n.handleAngle) * w;
    ndy += Math.sin(n.handleAngle) * w;
    totalW += w;
  }

  if (totalW > 0.001) {
    const blend = Math.min(1, totalW);
    const nl = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
    fx = fx * (1 - blend) + (ndx / nl) * blend;
    fy = fy * (1 - blend) + (ndy / nl) * blend;
  }

  const len = Math.sqrt(fx * fx + fy * fy) || 1;
  return [fx / len, fy / len];
}
