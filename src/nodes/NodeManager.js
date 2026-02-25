import { CX, CY } from '../utils/canvas.js';
import { normA } from '../utils/math.js';

// ── Constants ────────────────────────────────────────────────────────────────
const BASE_LEN = 22;
const MAX_BLEED = 180;
const HIT = 10;

// ── Anchor State ─────────────────────────────────────────────────────────────
let anchors = [];
let nextAnchorId = 1;
let activeAnchorId = null;
let placingAnchorForNode = null;  // node ID when in "place anchor" mode

// ── State ────────────────────────────────────────────────────────────────────
let nodes = [
  { id: 1, name: 'Node 1', angle: -Math.PI * 0.6, handleAngle: -Math.PI * 0.6 - Math.PI / 2, bleed: 0, spread: 1.2, t: 0,
    directionStrength: 0.7, pull: 0.5, fade: 0.3, stretch: 0.5, streamLength: 0.5, linkedAnchors: [] },
  { id: 2, name: 'Node 2', angle: Math.PI * 0.4, handleAngle: Math.PI * 0.4 - Math.PI / 2, bleed: 0, spread: 1.2, t: 0,
    directionStrength: 0.7, pull: 0.5, fade: 0.3, stretch: 0.5, streamLength: 0.5, linkedAnchors: [] },
];
let nextId = 3;
let activeId = null;
let dragState = null;

let flowMode = 'tangential';
let flowDir = 1;
let linearAng = -Math.PI / 2;

let fillDensity = 0.70;
let speedMult = 1.0;
let grainSpace = 9;
let stretchPct = 0.45;

let shapeRadius = 108; // fixed default (600 * 0.18), doesn't change on resize
let currentShape = null; // Shape object when using SVG
let currentSDF = null;   // DistanceField when using SVG
let paused = false;

// Undo/redo
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

// ── Getters ──────────────────────────────────────────────────────────────────
export function getState() {
  return {
    nodes, activeId, dragState, flowMode, flowDir, linearAng,
    fillDensity, speedMult, grainSpace, stretchPct, shapeRadius,
    currentShape, currentSDF, paused,
    anchors, activeAnchorId, placingAnchorForNode,
  };
}

export function getConstants() {
  return { BASE_LEN, MAX_BLEED, HIT };
}

// ── Setters ──────────────────────────────────────────────────────────────────
export function setActiveId(id) { activeId = id; }
export function setDragState(s) { dragState = s; }
export function setFlowMode(m) { flowMode = m; }
export function setFlowDir(d) { flowDir = d; }
export function setLinearAng(a) { linearAng = a; }
export function setFillDensity(v) { fillDensity = v; }
export function setSpeedMult(v) { speedMult = v; }
export function setGrainSpace(v) { grainSpace = v; }
export function setStretchPct(v) { stretchPct = v; }
export function setPaused(v) { paused = v; }
export function setShapeRadius(r) { shapeRadius = r; }
export function togglePaused() { paused = !paused; return paused; }

export function setShape(shape, sdf, skipNodeUpdate) {
  currentShape = shape;
  currentSDF = sdf;
  // Update node parametric positions (skip when caller handles this, e.g. rotate/scale)
  if (shape && !skipNodeUpdate) {
    for (const n of nodes) {
      // Convert angular position to parametric position on new shape
      const info = shape.getNearestBoundary(
        CX + Math.cos(n.angle) * shapeRadius,
        CY + Math.sin(n.angle) * shapeRadius
      );
      n.t = info.t;
    }
  }
}

export function clearShape() {
  currentShape = null;
  currentSDF = null;
}

// ── Node position helpers ────────────────────────────────────────────────────
export function nPos(n) {
  if (currentShape) {
    const info = currentShape.getPointAtT(n.t);
    return { x: info.point.x, y: info.point.y };
  }
  return { x: CX + Math.cos(n.angle) * shapeRadius, y: CY + Math.sin(n.angle) * shapeRadius };
}

export function hPos(n) {
  const p = nPos(n);
  if (n.bleed < 0.01) return { x: p.x, y: p.y };
  const len = BASE_LEN + n.bleed * MAX_BLEED;
  return { x: p.x + Math.cos(n.handleAngle) * len, y: p.y + Math.sin(n.handleAngle) * len };
}

// ── Hit testing ──────────────────────────────────────────────────────────────
export function hitTest(pos) {
  for (const n of nodes) {
    const h = hPos(n);
    if (Math.hypot(h.x - pos.x, h.y - pos.y) < HIT) return { type: 'handle', id: n.id };
  }
  for (const n of nodes) {
    const p = nPos(n);
    if (Math.hypot(p.x - pos.x, p.y - pos.y) < HIT) return { type: 'node', id: n.id };
  }

  // Hit test on anchors
  for (const a of anchors) {
    if (Math.hypot(a.x - pos.x, a.y - pos.y) < HIT * 1.5) return { type: 'anchor', id: a.id };
  }

  // Hit test on boundary
  if (currentShape) {
    const info = currentShape.getNearestBoundary(pos.x, pos.y);
    if (info.distance < HIT * 2) return { type: 'ring', t: info.t };
  } else {
    if (Math.abs(Math.hypot(pos.x - CX, pos.y - CY) - shapeRadius) < HIT * 2) {
      return { type: 'ring' };
    }
  }

  return null;
}

// ── Node CRUD ────────────────────────────────────────────────────────────────
export function addNode(angle, t) {
  const tanDirAng = Math.atan2(Math.cos(angle) * flowDir, -Math.sin(angle) * flowDir);
  const nd = {
    id: nextId++,
    name: `Node ${nextId - 1}`,
    angle: angle,
    handleAngle: tanDirAng,
    bleed: 0,
    spread: 1.2,
    t: t || 0,
    directionStrength: 0.7,
    pull: 0.5,
    fade: 0.3,
    stretch: 0.5,
    streamLength: 0.5,
    linkedAnchors: [],
  };
  nodes.push(nd);
  activeId = nd.id;
  return nd;
}

export function addNodeAtBestGap() {
  if (currentShape) {
    // Find largest parametric gap
    const ts = nodes.map(n => n.t).sort((a, b) => a - b);
    let bestT = 0;
    if (ts.length > 0) {
      let maxGap = 0;
      for (let i = 0; i < ts.length; i++) {
        const a = ts[i];
        const b = ts[(i + 1) % ts.length] + (i === ts.length - 1 ? 1 : 0);
        const gap = b - a;
        if (gap > maxGap) { maxGap = gap; bestT = (a + gap / 2) % 1; }
      }
    }
    const info = currentShape.getPointAtT(bestT);
    const angle = Math.atan2(info.point.y - CY, info.point.x - CX);
    return addNode(angle, bestT);
  } else {
    const angles = nodes.map(n => n.angle).sort((a, b) => a - b);
    let best = 0;
    if (angles.length > 0) {
      let max = 0;
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        const b = angles[(i + 1) % angles.length] + (i === angles.length - 1 ? Math.PI * 2 : 0);
        const g = b - a;
        if (g > max) { max = g; best = normA(a + g / 2); }
      }
    }
    return addNode(best, 0);
  }
}

export function deleteNode(id) {
  nodes = nodes.filter(n => n.id !== id);
  if (activeId === id) activeId = nodes.length ? nodes[0].id : null;
}

export function deleteActiveNode() {
  if (activeId !== null) deleteNode(activeId);
}

export function getNodeById(id) {
  return nodes.find(n => n.id === id);
}

export function selectNodeByIndex(idx) {
  if (idx >= 0 && idx < nodes.length) {
    activeId = nodes[idx].id;
  }
}

// ── Drag handling ────────────────────────────────────────────────────────────
export function handleDrag(pos) {
  if (!dragState) return;

  if (dragState.type === 'anchor') {
    const a = anchors.find(an => an.id === dragState.id);
    if (a) { a.x = pos.x; a.y = pos.y; }
    return;
  }

  const n = nodes.find(nd => nd.id === dragState.id);
  if (!n) return;

  if (dragState.type === 'node') {
    if (currentShape) {
      // Snap to boundary
      const info = currentShape.getNearestBoundary(pos.x, pos.y);
      n.t = info.t;
      n.angle = Math.atan2(info.point.y - CY, info.point.x - CX);
    } else {
      n.angle = Math.atan2(pos.y - CY, pos.x - CX);
    }
  } else if (dragState.type === 'handle') {
    const np = nPos(n);
    const dx = pos.x - np.x, dy = pos.y - np.y;
    n.handleAngle = Math.atan2(dy, dx);
    const len = Math.hypot(dx, dy);
    n.bleed = Math.max(0, Math.min(1, (len - BASE_LEN * 0.5) / MAX_BLEED));
  }
}

// ── Undo/Redo ────────────────────────────────────────────────────────────────
function captureState() {
  return { nodes: JSON.parse(JSON.stringify(nodes)), anchors: JSON.parse(JSON.stringify(anchors)) };
}

export function pushUndo() {
  undoStack.push(captureState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

export function undo() {
  if (undoStack.length === 0) return false;
  redoStack.push(captureState());
  const prev = undoStack.pop();
  nodes = prev.nodes;
  anchors = prev.anchors;
  nodes.forEach(ensureNodeDefaults);
  activeId = nodes.length ? nodes[0].id : null;
  activeAnchorId = null;
  return true;
}

export function redo() {
  if (redoStack.length === 0) return false;
  undoStack.push(captureState());
  const next = redoStack.pop();
  nodes = next.nodes;
  anchors = next.anchors;
  nodes.forEach(ensureNodeDefaults);
  activeId = nodes.length ? nodes[0].id : null;
  activeAnchorId = null;
  return true;
}

// ── Ensure node has all required fields (migration helper) ──────────────────
function ensureNodeDefaults(n) {
  if (n.directionStrength == null) n.directionStrength = 0.7;
  if (n.pull == null) n.pull = 0.5;
  if (n.fade == null) n.fade = 0.3;
  if (n.stretch == null) n.stretch = 0.5;
  if (n.streamLength == null) n.streamLength = 0.5;
  if (!n.linkedAnchors) n.linkedAnchors = [];
  if (!n.name) n.name = `Node ${n.id}`;
  return n;
}

// ── Anchor CRUD ─────────────────────────────────────────────────────────────
export function getAnchorById(id) {
  return anchors.find(a => a.id === id);
}

export function addAnchor(x, y) {
  const a = { id: nextAnchorId++, x, y, radius: 200, strength: 0.3, fade: 0.02, name: `Anchor ${nextAnchorId - 1}` };
  anchors.push(a);
  activeAnchorId = a.id;
  return a;
}

export function deleteAnchor(id) {
  anchors = anchors.filter(a => a.id !== id);
  // Remove from all nodes' linkedAnchors
  for (const n of nodes) {
    n.linkedAnchors = n.linkedAnchors.filter(aid => aid !== id);
  }
  if (activeAnchorId === id) activeAnchorId = null;
}

export function translateAnchors(dx, dy) {
  for (const a of anchors) {
    a.x += dx;
    a.y += dy;
  }
}

// Rotate all nodes (angles + handleAngles) and anchors around (cx, cy)
export function rotateNodesAndAnchors(angle, cx, cy) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (const n of nodes) {
    // Rotate node angular position
    n.angle = normA(n.angle + angle);
    // Rotate handle direction
    n.handleAngle = normA(n.handleAngle + angle);
  }
  // Rotate anchor positions around center
  for (const a of anchors) {
    const dx = a.x - cx, dy = a.y - cy;
    a.x = cx + dx * cos - dy * sin;
    a.y = cy + dx * sin + dy * cos;
  }
}

// Scale anchor positions relative to (cx, cy)
export function scaleAnchors(factor, cx, cy) {
  for (const a of anchors) {
    a.x = cx + (a.x - cx) * factor;
    a.y = cy + (a.y - cy) * factor;
    a.radius *= factor;
  }
}

export function setActiveAnchorId(id) { activeAnchorId = id; }
export function setPlacingAnchor(nodeId) { placingAnchorForNode = nodeId; }
export function getPlacingAnchor() { return placingAnchorForNode; }
export function clearPlacingAnchor() { placingAnchorForNode = null; }

export function linkAnchorToNode(nodeId, anchorId) {
  const n = nodes.find(nd => nd.id === nodeId);
  if (!n) return;
  const idx = n.linkedAnchors.indexOf(anchorId);
  if (idx >= 0) {
    n.linkedAnchors.splice(idx, 1);
  } else {
    n.linkedAnchors.push(anchorId);
  }
}

// ── Save/Restore (for file switching) ────────────────────────────────────────
export function saveNodeState() {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    anchors: JSON.parse(JSON.stringify(anchors)),
    nextNodeId: nextId,
    nextAnchorId: nextAnchorId,
    flowDir,
    activeNodeId: activeId,
    activeAnchorId,
    flowMode,
    linearAng,
    fillDensity,
    speedMult,
    grainSpace,
    stretchPct,
    undoStack: JSON.parse(JSON.stringify(undoStack)),
    redoStack: JSON.parse(JSON.stringify(redoStack)),
  };
}

export function restoreNodeState(snapshot) {
  nodes = snapshot.nodes;
  anchors = snapshot.anchors;
  nextId = snapshot.nextNodeId;
  nextAnchorId = snapshot.nextAnchorId;
  flowDir = snapshot.flowDir;
  activeId = snapshot.activeNodeId;
  activeAnchorId = snapshot.activeAnchorId;
  flowMode = snapshot.flowMode || 'tangential';
  linearAng = snapshot.linearAng != null ? snapshot.linearAng : -Math.PI / 2;
  fillDensity = snapshot.fillDensity != null ? snapshot.fillDensity : 0.70;
  speedMult = snapshot.speedMult != null ? snapshot.speedMult : 1.0;
  grainSpace = snapshot.grainSpace != null ? snapshot.grainSpace : 9;
  stretchPct = snapshot.stretchPct != null ? snapshot.stretchPct : 0.45;
  undoStack = snapshot.undoStack || [];
  redoStack = snapshot.redoStack || [];
  placingAnchorForNode = null;
  dragState = null;
  nodes.forEach(ensureNodeDefaults);
}

// ── Save/Restore with shape refs (for ShapeManager) ──────────────────────
export function saveNodeStateWithShape() {
  const snap = saveNodeState();
  snap.currentShape = currentShape;
  snap.currentSDF = currentSDF;
  snap.shapeRadius = shapeRadius;
  return snap;
}

export function restoreNodeStateWithShape(snap) {
  if (!snap) return;
  restoreNodeState(snap);
  if (snap.currentShape !== undefined) currentShape = snap.currentShape;
  if (snap.currentSDF !== undefined) currentSDF = snap.currentSDF;
  if (snap.shapeRadius !== undefined) shapeRadius = snap.shapeRadius;
}

// ── Presets ──────────────────────────────────────────────────────────────────
export function applyPreset(name) {
  pushUndo();
  switch (name) {
    case 'dissolve-right':
      flowMode = 'linear';
      linearAng = 0;
      flowDir = 1;
      nodes = [
        { id: nextId++, angle: 0, handleAngle: 0, bleed: 0.6, spread: 2.0, t: 0 },
      ];
      break;
    case 'spiral-out':
      flowMode = 'tangential';
      flowDir = 1;
      nodes = [
        { id: nextId++, angle: 0, handleAngle: Math.PI * 0.3, bleed: 0.4, spread: Math.PI, t: 0 },
        { id: nextId++, angle: Math.PI, handleAngle: Math.PI * 1.3, bleed: 0.4, spread: Math.PI, t: 0.5 },
      ];
      break;
    case 'radial-burst':
      flowMode = 'radial';
      flowDir = 1;
      nodes = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        nodes.push({
          id: nextId++, angle: a, handleAngle: a, bleed: 0.5, spread: 0.8,
          t: i / 6,
        });
      }
      break;
    case 'gentle-drift':
      flowMode = 'linear';
      linearAng = -Math.PI / 4;
      flowDir = 1;
      nodes = [
        { id: nextId++, angle: -Math.PI / 4, handleAngle: -Math.PI / 4, bleed: 0.3, spread: 1.5, t: 0 },
      ];
      break;
    default: {
      // Try custom preset from localStorage
      const custom = loadCustomPresets();
      const preset = custom[name];
      if (preset) {
        nodes = JSON.parse(JSON.stringify(preset.nodes));
        flowMode = preset.flowMode;
        flowDir = preset.flowDir;
        linearAng = preset.linearAng;
        fillDensity = preset.fillDensity;
        speedMult = preset.speedMult;
        grainSpace = preset.grainSpace;
        stretchPct = preset.stretchPct;
      }
      break;
    }
  }
  nodes.forEach(ensureNodeDefaults);
  activeId = nodes.length ? nodes[0].id : null;
}

export function saveCustomPreset(name) {
  const presets = loadCustomPresets();
  presets[name] = {
    nodes: JSON.parse(JSON.stringify(nodes)),
    flowMode, flowDir, linearAng, fillDensity, speedMult, grainSpace, stretchPct,
  };
  localStorage.setItem('flow-dither-presets', JSON.stringify(presets));
}

export function loadCustomPresets() {
  try {
    return JSON.parse(localStorage.getItem('flow-dither-presets') || '{}');
  } catch { return {}; }
}
