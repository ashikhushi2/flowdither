import { saveNodeStateWithShape, restoreNodeStateWithShape } from '../nodes/NodeManager.js';
import { createParticleSnapshot, loadFromSnapshot, saveToSnapshot } from './ParticleSystem.js';

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
}

export function getMaxPerAsset() { return MAX_PER_ASSET; }

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
