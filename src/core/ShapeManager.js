import { saveNodeStateWithShape, restoreNodeStateWithShape, saveAnchorState, restoreAnchorState } from '../nodes/NodeManager.js';
import { createParticleSnapshot, loadFromSnapshot, saveToSnapshot } from './ParticleSystem.js';
import { DistanceField } from './DistanceField.js';
import { Shape } from './ShapeParser.js';

const MAX_PER_ASSET = 2000;

let assets = [];
let selectedAssetId = null;
let nextAssetId = 1;
let bgColor = '#000000';

// ── Asset CRUD ───────────────────────────────────────────────────────────────

export function addAsset(shape, sdf, name) {
  const id = nextAssetId++;
  const particles = createParticleSnapshot(MAX_PER_ASSET);
  const asset = {
    id,
    name: name || `Shape ${id}`,
    shape,
    sdf,
    nodeState: null,  // will be populated on first save or by caller
    particles,
  };
  assets.push(asset);
  return asset;
}

export function removeAsset(id) {
  assets = assets.filter(a => a.id !== id);
  if (selectedAssetId === id) {
    selectedAssetId = null;
  }
}

export function selectAsset(id) {
  // Save current selection's live state before switching
  if (selectedAssetId !== null) {
    saveCurrentAssetLiveState();
  }

  const asset = assets.find(a => a.id === id);
  if (!asset) return;

  selectedAssetId = id;

  // Restore this asset's state into globals
  if (asset.nodeState) {
    restoreNodeStateWithShape(asset.nodeState);
  }
  loadFromSnapshot(asset.particles);
}

export function deselectAll() {
  if (selectedAssetId !== null) {
    saveCurrentAssetLiveState();
  }
  selectedAssetId = null;
}

export function saveCurrentAssetLiveState() {
  if (selectedAssetId === null) return;
  const asset = assets.find(a => a.id === selectedAssetId);
  if (!asset) return;

  asset.nodeState = saveNodeStateWithShape();
  saveToSnapshot(asset.particles);

  // Keep asset.shape/sdf in sync with current globals
  if (asset.nodeState.currentShape) asset.shape = asset.nodeState.currentShape;
  if (asset.nodeState.currentSDF) asset.sdf = asset.nodeState.currentSDF;
}

// ── Getters ──────────────────────────────────────────────────────────────────

export function getSelectedAssetId() { return selectedAssetId; }
export function getAllAssets() { return assets; }
export function getAssetById(id) { return assets.find(a => a.id === id); }

// ── Background color ─────────────────────────────────────────────────────────

export function getBgColor() { return bgColor; }
export function setBgColor(hex) { bgColor = hex; }

// ── File save/restore ────────────────────────────────────────────────────────

export function saveAllState() {
  // Make sure current selection is saved
  if (selectedAssetId !== null) {
    saveCurrentAssetLiveState();
  }
  return {
    assets: assets.map(a => {
      // Use nodeState's shape/SDF as authoritative source (always up-to-date after saveCurrentAssetLiveState)
      const srcShape = (a.nodeState && a.nodeState.currentShape) || a.shape;
      const srcSdf = (a.nodeState && a.nodeState.currentSDF) || a.sdf;
      // Clone so in-place mutations (translate/scale/rotate) don't corrupt the snapshot
      const clonedShape = srcShape ? srcShape.clone() : null;
      const clonedSdf = srcSdf ? srcSdf.clone(clonedShape) : null;

      // Clone nodeState with cloned shape/sdf refs
      let clonedNodeState = null;
      if (a.nodeState) {
        clonedNodeState = { ...a.nodeState };
        if (clonedNodeState.currentShape) clonedNodeState.currentShape = clonedShape;
        if (clonedNodeState.currentSDF) clonedNodeState.currentSDF = clonedSdf;
      }

      return {
        id: a.id,
        name: a.name,
        shape: clonedShape,
        sdf: clonedSdf,
        nodeState: clonedNodeState,
        particles: {
          px: a.particles.px.slice(),
          py: a.particles.py.slice(),
          pvx: a.particles.pvx.slice(),
          pvy: a.particles.pvy.slice(),
          plife: a.particles.plife.slice(),
          pmaxLife: a.particles.pmaxLife.slice(),
          psize: a.particles.psize.slice(),
          pescInf: a.particles.pescInf.slice(),
          pfade: a.particles.pfade.slice(),
          pdetach: new Uint8Array(a.particles.pdetach),
          pdirX: a.particles.pdirX.slice(),
          pdirY: a.particles.pdirY.slice(),
          pSpeed: a.particles.pSpeed.slice(),
          pSLen: a.particles.pSLen.slice(),
          pDetachT: a.particles.pDetachT.slice(),
          pSourceNode: new Int16Array(a.particles.pSourceNode),
          count: a.particles.count,
          maxCount: a.particles.maxCount,
          shape: clonedShape,
          sdf: clonedSdf,
        },
      };
    }),
    selectedAssetId,
    nextAssetId,
    bgColor,
    anchorState: saveAnchorState(),
  };
}

export function restoreAllState(snapshot) {
  if (!snapshot) return;
  assets = snapshot.assets.map(a => ({
    id: a.id,
    name: a.name,
    shape: a.shape,
    sdf: a.sdf,
    nodeState: a.nodeState,
    particles: {
      px: new Float32Array(a.particles.px),
      py: new Float32Array(a.particles.py),
      pvx: new Float32Array(a.particles.pvx),
      pvy: new Float32Array(a.particles.pvy),
      plife: new Float32Array(a.particles.plife),
      pmaxLife: new Float32Array(a.particles.pmaxLife),
      psize: new Float32Array(a.particles.psize),
      pescInf: new Float32Array(a.particles.pescInf),
      pfade: new Float32Array(a.particles.pfade),
      pdetach: new Uint8Array(a.particles.pdetach),
      pdirX: new Float32Array(a.particles.pdirX),
      pdirY: new Float32Array(a.particles.pdirY),
      pSpeed: new Float32Array(a.particles.pSpeed),
      pSLen: new Float32Array(a.particles.pSLen),
      pDetachT: new Float32Array(a.particles.pDetachT),
      pSourceNode: new Int16Array(a.particles.pSourceNode),
      count: a.particles.count,
      maxCount: a.particles.maxCount,
      shape: a.particles.shape,
      sdf: a.particles.sdf,
    },
  }));
  selectedAssetId = snapshot.selectedAssetId;
  nextAssetId = snapshot.nextAssetId;
  bgColor = snapshot.bgColor || '#000000';
  if (snapshot.anchorState) restoreAnchorState(snapshot.anchorState);
}

export function getMaxPerAsset() { return MAX_PER_ASSET; }

export function duplicateAsset(id, dx = 20, dy = 20) {
  const src = assets.find(a => a.id === id);
  if (!src) return null;

  // Clone shape with offset
  const clonedShape = src.shape.clone();
  clonedShape.translate(dx, dy);
  const clonedSdf = new DistanceField(clonedShape);
  clonedSdf.compute();

  // Clone nodeState
  let clonedNodeState = null;
  if (src.nodeState) {
    clonedNodeState = { ...src.nodeState };
    clonedNodeState.currentShape = clonedShape;
    clonedNodeState.currentSDF = clonedSdf;
    if (clonedNodeState.nodes) {
      clonedNodeState.nodes = clonedNodeState.nodes.map(n => ({ ...n, linkedAnchors: n.linkedAnchors ? [...n.linkedAnchors] : [] }));
    }
    clonedNodeState.undoStack = [];
    clonedNodeState.redoStack = [];
  }

  // Clone particles (deep copy all typed arrays)
  const clonedParticles = {
    px: src.particles.px.slice(),
    py: src.particles.py.slice(),
    pvx: src.particles.pvx.slice(),
    pvy: src.particles.pvy.slice(),
    plife: src.particles.plife.slice(),
    pmaxLife: src.particles.pmaxLife.slice(),
    psize: src.particles.psize.slice(),
    pescInf: src.particles.pescInf.slice(),
    pfade: src.particles.pfade.slice(),
    pdetach: new Uint8Array(src.particles.pdetach),
    pdirX: src.particles.pdirX.slice(),
    pdirY: src.particles.pdirY.slice(),
    pSpeed: src.particles.pSpeed.slice(),
    pSLen: src.particles.pSLen.slice(),
    pDetachT: src.particles.pDetachT.slice(),
    pSourceNode: new Int16Array(src.particles.pSourceNode),
    count: src.particles.count,
    maxCount: src.particles.maxCount,
    shape: clonedShape,
    sdf: clonedSdf,
  };
  // Offset particle positions
  for (let i = 0; i < clonedParticles.count; i++) {
    clonedParticles.px[i] += dx;
    clonedParticles.py[i] += dy;
  }

  const newId = nextAssetId++;
  const newAsset = {
    id: newId,
    name: src.name + ' copy',
    shape: clonedShape,
    sdf: clonedSdf,
    nodeState: clonedNodeState,
    particles: clonedParticles,
  };
  assets.push(newAsset);
  return newAsset;
}

// ── JSON serialization (for .flowasset save/load) ─────────────────────────────

// Typed array field names in particle snapshots
const FLOAT32_FIELDS = ['px','py','pvx','pvy','plife','pmaxLife','psize','pescInf','pfade','pdirX','pdirY','pSpeed','pSLen','pDetachT'];
const UINT8_FIELDS = ['pdetach'];
const INT16_FIELDS = ['pSourceNode'];

export function serializeState() {
  if (selectedAssetId !== null) {
    saveCurrentAssetLiveState();
  }
  return {
    assets: assets.map(a => {
      const srcShape = (a.nodeState && a.nodeState.currentShape) || a.shape;

      // Serialize nodeState, stripping non-serializable refs
      let ns = null;
      if (a.nodeState) {
        ns = { ...a.nodeState };
        // Remove object references that get rebuilt
        delete ns.currentShape;
        delete ns.currentSDF;
        delete ns.undoStack;
        delete ns.redoStack;
        // Deep-copy nodes to plain objects
        if (ns.nodes) ns.nodes = JSON.parse(JSON.stringify(ns.nodes));
      }

      // Serialize particles: typed arrays → regular arrays
      const p = a.particles;
      const sp = {
        count: p.count,
        maxCount: p.maxCount,
      };
      for (const k of FLOAT32_FIELDS) sp[k] = Array.from(p[k]);
      for (const k of UINT8_FIELDS) sp[k] = Array.from(p[k]);
      for (const k of INT16_FIELDS) sp[k] = Array.from(p[k]);

      return {
        id: a.id,
        name: a.name,
        shape: srcShape ? srcShape.toJSON() : null,
        nodeState: ns,
        particles: sp,
      };
    }),
    selectedAssetId,
    nextAssetId,
    bgColor,
    anchorState: saveAnchorState(),
  };
}

export function deserializeState(data) {
  assets = data.assets.map(a => {
    // Reconstruct shape from JSON (uses raycast isPointInside)
    const shape = a.shape ? Shape.fromJSON(a.shape) : null;

    // Rebuild SDF from shape
    let sdf = null;
    if (shape) {
      sdf = new DistanceField(shape);
      sdf.compute();
    }

    // Rebuild nodeState with shape/sdf refs
    let nodeState = null;
    if (a.nodeState) {
      nodeState = { ...a.nodeState };
      nodeState.currentShape = shape;
      nodeState.currentSDF = sdf;
      nodeState.undoStack = [];
      nodeState.redoStack = [];
    }

    // Rebuild particles: regular arrays → typed arrays
    const sp = a.particles;
    const maxCount = sp.maxCount || MAX_PER_ASSET;
    const particles = {
      count: sp.count || 0,
      maxCount,
      shape,
      sdf,
    };
    for (const k of FLOAT32_FIELDS) particles[k] = new Float32Array(sp[k] || maxCount);
    for (const k of UINT8_FIELDS) particles[k] = new Uint8Array(sp[k] || maxCount);
    for (const k of INT16_FIELDS) particles[k] = new Int16Array(sp[k] || maxCount);

    return { id: a.id, name: a.name, shape, sdf, nodeState, particles };
  });

  selectedAssetId = data.selectedAssetId;
  nextAssetId = data.nextAssetId;
  bgColor = data.bgColor || '#000000';
  if (data.anchorState) restoreAnchorState(data.anchorState);
}

// ── Unified undo/redo (full state snapshots) ──────────────────────────────────

let undoStack = [];
let redoStack = [];

export function pushGlobalUndo() {
  undoStack.push(saveAllState());
  redoStack.length = 0;
  if (undoStack.length > 50) undoStack.shift();
}

export function globalUndo() {
  if (undoStack.length === 0) return false;
  redoStack.push(saveAllState());
  const snapshot = undoStack.pop();
  restoreAllState(snapshot);
  return true;
}

export function globalRedo() {
  if (redoStack.length === 0) return false;
  undoStack.push(saveAllState());
  const snapshot = redoStack.pop();
  restoreAllState(snapshot);
  return true;
}
