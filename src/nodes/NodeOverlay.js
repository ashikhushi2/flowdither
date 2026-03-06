import { SCALE, CX, CY, W, H, getCanvasRefs } from '../utils/canvas.js';
import { nodeColor, hexAlpha } from '../utils/color.js';
import { getState, nPos, hPos, getAnchorById } from './NodeManager.js';
import { getAllAssets, getSelectedAssetId } from '../core/ShapeManager.js';
import { getPenToolState, getBboxHandlePositions, getVertexPositions } from '../main.js';

const S = SCALE;

function drawShapeOutline(octx, shape, strokeStyle, lineWidth) {
  if (!shape) return;
  octx.beginPath();
  const pts = shape.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) octx.moveTo(p.x * S, p.y * S);
    else octx.lineTo(p.x * S, p.y * S);
  }
  octx.closePath();
  octx.strokeStyle = strokeStyle;
  octx.lineWidth = lineWidth;
  octx.stroke();
}

function _drawAnchors(octx, state, nodes) {
  const { anchors, activeAnchorId } = state;

  // Dashed lines from linked nodes to their anchors
  octx.setLineDash([4, 4]);
  nodes.forEach((n, idx) => {
    if (!n.linkedAnchors || n.linkedAnchors.length === 0) return;
    const np = nPos(n);
    const col = nodeColor(idx);
    for (const aid of n.linkedAnchors) {
      const a = getAnchorById(aid);
      if (!a) continue;
      octx.beginPath();
      octx.moveTo(np.x * S, np.y * S);
      octx.lineTo(a.x * S, a.y * S);
      octx.strokeStyle = hexAlpha(col, 0.2);
      octx.lineWidth = 1;
      octx.stroke();
    }
  });
  octx.setLineDash([]);

  for (const a of anchors) {
    const ax = a.x * S, ay = a.y * S;
    const isActive = a.id === activeAnchorId;
    const alpha = isActive ? 1.0 : 0.6;

    // Dashed radius circle
    octx.beginPath();
    octx.arc(ax, ay, a.radius * S, 0, Math.PI * 2);
    octx.setLineDash([6, 4]);
    octx.strokeStyle = `rgba(255,170,0,${isActive ? 0.2 : 0.1})`;
    octx.lineWidth = 1;
    octx.stroke();
    octx.setLineDash([]);

    // Active glow
    if (isActive) {
      const g = octx.createRadialGradient(ax, ay, 0, ax, ay, 30);
      g.addColorStop(0, 'rgba(255,170,0,0.25)');
      g.addColorStop(1, 'rgba(255,170,0,0)');
      octx.fillStyle = g;
      octx.beginPath();
      octx.arc(ax, ay, 30, 0, Math.PI * 2);
      octx.fill();
    }

    // Diamond marker
    const ds = isActive ? 8 : 6;
    octx.beginPath();
    octx.moveTo(ax, ay - ds);
    octx.lineTo(ax + ds, ay);
    octx.lineTo(ax, ay + ds);
    octx.lineTo(ax - ds, ay);
    octx.closePath();
    octx.fillStyle = `rgba(255,170,0,${alpha})`;
    octx.fill();
    octx.strokeStyle = 'rgba(0,0,0,0.5)';
    octx.lineWidth = 1.5;
    octx.stroke();

    // Name label
    octx.font = `bold ${isActive ? 9 : 8}px 'SF Mono', monospace`;
    octx.fillStyle = `rgba(255,170,0,${isActive ? 0.9 : 0.5})`;
    octx.textAlign = 'center';
    octx.textBaseline = 'top';
    octx.fillText(a.name, ax, ay + ds + 4);
  }
}

export function renderOverlay(shapeTransform) {
  const { octx } = getCanvasRefs();
  const state = getState();
  const { nodes, activeId, flowMode, flowDir, shapeRadius, currentShape } = state;
  const MAX_BLEED = 180;

  octx.clearRect(0, 0, W, H);

  // Draw ALL assets' shape outlines
  const selId = getSelectedAssetId();
  for (const asset of getAllAssets()) {
    if (asset.id === selId) continue; // draw selected last, with transform
    const assetShape = asset.particles?.shape || (asset.nodeState?.currentShape);
    if (assetShape) {
      drawShapeOutline(octx, assetShape, '#1a1a1a', 1);
    }
  }

  // [SHAPE-TOOLS] Vertex drag preview — lightweight outline only
  if (shapeTransform?.vertexPreview) {
    const verts = shapeTransform.vertexPreview;
    const activeIdx = shapeTransform.vertexIndex;
    // Draw polygon outline from preview vertices
    octx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      if (i === 0) octx.moveTo(verts[i].x * S, verts[i].y * S);
      else octx.lineTo(verts[i].x * S, verts[i].y * S);
    }
    octx.closePath();
    octx.strokeStyle = '#555';
    octx.lineWidth = 2;
    octx.stroke();
    // Draw vertex circles
    for (let i = 0; i < verts.length; i++) {
      octx.beginPath();
      octx.arc(verts[i].x * S, verts[i].y * S, 5, 0, Math.PI * 2);
      octx.fillStyle = i === activeIdx ? '#fff' : 'rgba(255,255,255,0.8)';
      octx.fill();
      octx.strokeStyle = 'rgba(0,0,0,0.5)';
      octx.lineWidth = 1;
      octx.stroke();
    }
    return;
  }

  // Apply visual transform during shape drag/slider preview (for selected asset only)
  const hasTransform = shapeTransform != null;
  if (hasTransform) {
    const { dx = 0, dy = 0, scale = 1, scaleX, scaleY, rotate = 0, cx = 0, cy = 0 } = shapeTransform;
    const sx = scaleX || scale || 1;
    const sy = scaleY || scale || 1;
    octx.save();
    octx.translate(cx * S, cy * S);
    octx.rotate(rotate);
    octx.scale(sx, sy);
    octx.translate(-cx * S, -cy * S);
    octx.translate(dx * S, dy * S);
  }

  // Selected shape outline (thicker, brighter)
  if (selId !== null) {
    if (currentShape) {
      drawShapeOutline(octx, currentShape, '#555', 2);
    } else if (getAllAssets().length > 0) {
      octx.beginPath();
      octx.arc(CX * S, CY * S, shapeRadius * S, 0, Math.PI * 2);
      octx.strokeStyle = '#555';
      octx.lineWidth = 2;
      octx.stroke();
    }
  } else {
    // No selection — still draw current shape outline if any
    if (currentShape) {
      drawShapeOutline(octx, currentShape, '#2a2a2a', 1.5);
    } else if (getAllAssets().length > 0) {
      octx.beginPath();
      octx.arc(CX * S, CY * S, shapeRadius * S, 0, Math.PI * 2);
      octx.strokeStyle = '#2a2a2a';
      octx.lineWidth = 1.5;
      octx.stroke();
    }
  }

  // ── Draw anchors (always visible, regardless of selection) ──────────────
  _drawAnchors(octx, state, nodes);

  // Only draw nodes/flow indicator for selected asset
  // When pen tool is active, skip heavy node rendering entirely
  const penState = getPenToolState();
  if (selId === null || penState.active) {
    if (hasTransform) octx.restore();
    // Jump straight to pen tool preview if active
    if (penState.active) {
      _drawPenPreview(octx, penState);
    }
    return;
  }

  // Flow direction indicator (circle mode only)
  if (!currentShape && flowMode === 'tangential') {
    const ar = shapeRadius * 0.28 * S;
    const sa = -Math.PI * 0.6;
    octx.beginPath();
    octx.arc(CX * S, CY * S, ar, sa, sa + flowDir * Math.PI * 1.4, flowDir < 0);
    octx.strokeStyle = 'rgba(255,255,255,0.06)';
    octx.lineWidth = 1;
    octx.stroke();

    const ea = sa + flowDir * Math.PI * 1.4;
    const tip = { x: CX * S + Math.cos(ea) * ar, y: CY * S + Math.sin(ea) * ar };
    const td = { x: -Math.sin(ea) * flowDir, y: Math.cos(ea) * flowDir };
    octx.beginPath();
    octx.moveTo(tip.x, tip.y);
    octx.lineTo(tip.x - td.x * 6 + td.y * 3, tip.y - td.y * 6 - td.x * 3);
    octx.lineTo(tip.x - td.x * 6 - td.y * 3, tip.y - td.y * 6 + td.x * 3);
    octx.closePath();
    octx.fillStyle = 'rgba(255,255,255,0.06)';
    octx.fill();
  }

  // Draw nodes
  nodes.forEach((n, idx) => {
    const np = nPos(n);
    const hp = hPos(n);
    const act = n.id === activeId;
    const nx = np.x * S, ny = np.y * S;
    const hx = hp.x * S, hy = hp.y * S;
    const col = nodeColor(idx);
    const alpha = act ? 1.0 : 0.6;

    // Spread arc on ring (circle mode) or boundary highlight
    if (!currentShape) {
      const a1 = n.angle - n.spread, a2 = n.angle + n.spread;
      octx.beginPath();
      octx.arc(CX * S, CY * S, shapeRadius * S, a1, a2);
      octx.strokeStyle = hexAlpha(col, act ? 0.5 : 0.2);
      octx.lineWidth = act ? 6 : 4;
      octx.stroke();
    } else {
      // Highlight boundary segment for spread
      const spreadT = n.spread / (Math.PI * 2);
      const startT = ((n.t - spreadT) % 1 + 1) % 1;
      const endT = ((n.t + spreadT) % 1 + 1) % 1;
      const pts = currentShape.points;
      const numPts = pts.length;

      octx.beginPath();
      let started = false;
      const steps = Math.round(spreadT * 2 * numPts);
      for (let i = 0; i <= steps; i++) {
        const ct = ((startT + (i / steps) * spreadT * 2) % 1 + 1) % 1;
        const pidx = Math.round(ct * numPts) % numPts;
        const p = pts[pidx];
        if (!started) { octx.moveTo(p.x * S, p.y * S); started = true; }
        else octx.lineTo(p.x * S, p.y * S);
      }
      octx.strokeStyle = hexAlpha(col, act ? 0.5 : 0.2);
      octx.lineWidth = act ? 6 : 4;
      octx.stroke();
    }

    // Bleed ghost visualization
    if (n.bleed > 0.03) {
      const reach = ((!currentShape ? shapeRadius : 0) + n.bleed * MAX_BLEED * 1.2) * S;
      const baseR = (!currentShape ? shapeRadius : 0) * S;
      const g = octx.createRadialGradient(nx, ny, 0, nx, ny, reach - baseR || reach);
      g.addColorStop(0, hexAlpha(col, act ? 0.12 : 0.05));
      g.addColorStop(0.4, hexAlpha(col, act ? 0.04 : 0.02));
      g.addColorStop(1, hexAlpha(col, 0));
      octx.fillStyle = g;
      octx.beginPath();
      octx.arc(nx, ny, reach - baseR || reach, 0, Math.PI * 2);
      octx.fill();
    }

    // Active node glow
    if (act) {
      const g = octx.createRadialGradient(nx, ny, 0, nx, ny, 60);
      g.addColorStop(0, hexAlpha(col, 0.2));
      g.addColorStop(1, hexAlpha(col, 0));
      octx.fillStyle = g;
      octx.beginPath();
      octx.arc(nx, ny, 60, 0, Math.PI * 2);
      octx.fill();
    }

    // Arrow stem
    octx.beginPath();
    octx.moveTo(nx, ny);
    octx.lineTo(hx, hy);
    octx.strokeStyle = hexAlpha(col, alpha);
    octx.lineWidth = act ? 2.5 : 1.8;
    octx.setLineDash([]);
    octx.stroke();

    // Arrowhead
    const ang = n.handleAngle;
    const al = 12;
    octx.save();
    octx.translate(hx, hy);
    octx.rotate(ang);
    octx.beginPath();
    octx.moveTo(0, 0);
    octx.lineTo(-al, -al * 0.4);
    octx.lineTo(-al, al * 0.4);
    octx.closePath();
    octx.fillStyle = hexAlpha(col, alpha);
    octx.fill();
    octx.restore();

    // Handle tip
    octx.beginPath();
    octx.arc(hx, hy, act ? 7 : 5, 0, Math.PI * 2);
    octx.fillStyle = hexAlpha(col, alpha);
    octx.fill();
    octx.strokeStyle = 'rgba(0,0,0,0.5)';
    octx.lineWidth = 1.5;
    octx.stroke();

    // Node anchor on ring
    octx.beginPath();
    octx.arc(nx, ny, act ? 8 : 6, 0, Math.PI * 2);
    octx.fillStyle = '#080808';
    octx.fill();
    octx.strokeStyle = hexAlpha(col, alpha);
    octx.lineWidth = act ? 2.5 : 2;
    octx.stroke();

    // Inner dot
    octx.beginPath();
    octx.arc(nx, ny, act ? 3 : 2.5, 0, Math.PI * 2);
    octx.fillStyle = hexAlpha(col, alpha);
    octx.fill();

    // Index label
    const labelDist = currentShape ? 18 : 18;
    // For arbitrary shapes, place label along normal
    let lx, ly;
    if (currentShape) {
      const info = currentShape.getPointAtT(n.t);
      lx = (info.point.x + info.normal.x * labelDist) * S;
      ly = (info.point.y + info.normal.y * labelDist) * S;
    } else {
      lx = (CX + Math.cos(n.angle) * (shapeRadius + labelDist)) * S;
      ly = (CY + Math.sin(n.angle) * (shapeRadius + labelDist)) * S;
    }
    octx.font = `bold ${act ? 11 : 10}px 'SF Mono', monospace`;
    octx.fillStyle = hexAlpha(col, act ? 1 : 0.65);
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(idx + 1, lx, ly);
  });

  // ── Center marker (crosshair) ──────────────────────────────────────────
  if (currentShape) {
    const b = currentShape.bounds;
    const cmx = ((b.minX + b.maxX) / 2 + (state.centerOffsetX || 0)) * S;
    const cmy = ((b.minY + b.maxY) / 2 + (state.centerOffsetY || 0)) * S;
    const cs = 8; // crosshair arm length

    // Crosshair +
    octx.beginPath();
    octx.moveTo(cmx - cs, cmy);
    octx.lineTo(cmx + cs, cmy);
    octx.moveTo(cmx, cmy - cs);
    octx.lineTo(cmx, cmy + cs);
    octx.strokeStyle = '#00cccc';
    octx.lineWidth = 1.5;
    octx.stroke();

    // Circle around crosshair
    octx.beginPath();
    octx.arc(cmx, cmy, 5, 0, Math.PI * 2);
    octx.strokeStyle = '#00cccc';
    octx.lineWidth = 1.5;
    octx.stroke();
  }

  // (anchors drawn earlier via _drawAnchors)

  // Restore after shape transform
  if (hasTransform) {
    octx.restore();
  }

  // [SHAPE-TOOLS] Bbox handles (drawn after transform restore, in screen space)
  if (selId !== null && currentShape && !hasTransform) {
    const b = currentShape.bounds;
    const handles = getBboxHandlePositions(b);
    for (const h of handles) {
      octx.fillStyle = '#fff';
      octx.fillRect(h.x * S - 3, h.y * S - 3, 6, 6);
      octx.strokeStyle = 'rgba(0,0,0,0.5)';
      octx.lineWidth = 1;
      octx.strokeRect(h.x * S - 3, h.y * S - 3, 6, 6);
    }
    // Vertex handles (circles) — drawn on top of bbox squares
    const verts = getVertexPositions();
    if (verts) {
      for (const v of verts) {
        octx.beginPath();
        octx.arc(v.x * S, v.y * S, 5, 0, Math.PI * 2);
        octx.fillStyle = '#fff';
        octx.fill();
        octx.strokeStyle = 'rgba(0,0,0,0.5)';
        octx.lineWidth = 1;
        octx.stroke();
      }
    }
  }

  // [SHAPE-TOOLS] Pen tool preview (drawn after everything else)
  if (penState.active) {
    _drawPenPreview(octx, penState);
  }
}

function _drawPenPreview(octx, penState) {
  const pts = penState.points;
  // Draw lines between consecutive points
  if (pts.length > 0) {
    octx.beginPath();
    octx.moveTo(pts[0].x * S, pts[0].y * S);
    for (let i = 1; i < pts.length; i++) {
      octx.lineTo(pts[i].x * S, pts[i].y * S);
    }
    octx.strokeStyle = 'rgba(255,255,255,0.6)';
    octx.lineWidth = 1;
    octx.stroke();

    // Dashed preview line from last point to cursor
    if (penState.cursor) {
      octx.beginPath();
      octx.moveTo(pts[pts.length - 1].x * S, pts[pts.length - 1].y * S);
      octx.lineTo(penState.cursor.x * S, penState.cursor.y * S);
      octx.setLineDash([4, 4]);
      octx.strokeStyle = 'rgba(255,255,255,0.4)';
      octx.lineWidth = 1;
      octx.stroke();
      octx.setLineDash([]);
    }
  }

  // Snap-to-close indicator: highlight ring + dashed closing line
  if (penState.snapClose && pts.length >= 2) {
    // Highlight ring around first point
    octx.beginPath();
    octx.arc(pts[0].x * S, pts[0].y * S, 8, 0, Math.PI * 2);
    octx.fillStyle = 'rgba(255,255,255,0.15)';
    octx.fill();
    octx.strokeStyle = 'rgba(255,255,255,0.5)';
    octx.lineWidth = 1.5;
    octx.stroke();

    // Dashed closing line from last point to first point
    octx.beginPath();
    octx.moveTo(pts[pts.length - 1].x * S, pts[pts.length - 1].y * S);
    octx.lineTo(pts[0].x * S, pts[0].y * S);
    octx.setLineDash([4, 4]);
    octx.strokeStyle = 'rgba(255,255,255,0.5)';
    octx.lineWidth = 1;
    octx.stroke();
    octx.setLineDash([]);
  }

  // Draw placed points as circles
  for (const p of pts) {
    octx.beginPath();
    octx.arc(p.x * S, p.y * S, 4, 0, Math.PI * 2);
    octx.fillStyle = '#fff';
    octx.fill();
    octx.strokeStyle = 'rgba(0,0,0,0.5)';
    octx.lineWidth = 1;
    octx.stroke();
  }
}
