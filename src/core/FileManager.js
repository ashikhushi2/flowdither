import { DW, DH, setCanvasDimensions, resizeCanvasElements, getCanvasRefs, W, H } from '../utils/canvas.js';
import { restoreNodeState, getState, setFillDensity, setSpeedMult, setGrainSpace, setStretchPct, setFlowDir, setShape, saveNodeStateWithShape } from '../nodes/NodeManager.js';
import { init as initParticles, reinit as reinitParticles, saveToSnapshot } from './ParticleSystem.js';
import { createCircleShape } from './ShapeParser.js';
import { DistanceField } from './DistanceField.js';
import {
  saveAllState, restoreAllState, getBgColor, setBgColor,
  addAsset, selectAsset, getSelectedAssetId,
} from './ShapeManager.js';

let files = [];
let activeFileId = null;
let nextFileId = 1;

// Callbacks set by main.js
let onSwitch = null;

export function setOnSwitch(cb) { onSwitch = cb; }

export function initFileManager() {
  const file = makeFile('Untitled 1', DW, DH);
  files.push(file);
  activeFileId = file.id;
  return file;
}

function makeFile(name, w, h) {
  return {
    id: nextFileId++,
    name,
    canvasWidth: w,
    canvasHeight: h,
    assetsSnapshot: null,
    bgColor: '#000000',
  };
}

export function createFile(name, w, h) {
  const idx = files.length + 1;
  const fname = name || `Untitled ${idx}`;
  const fw = w || 600;
  const fh = h || 600;

  // Save current file state first
  saveCurrentFile();

  const file = makeFile(fname, fw, fh);
  files.push(file);

  // Switch to new file
  activateFile(file.id);
  return file;
}

export function switchToFile(id) {
  if (id === activeFileId) return;
  saveCurrentFile();
  activateFile(id);
}

export function deleteFile(id) {
  if (files.length <= 1) return false;
  const idx = files.findIndex(f => f.id === id);
  if (idx < 0) return false;

  files.splice(idx, 1);

  if (activeFileId === id) {
    const newIdx = Math.min(idx, files.length - 1);
    activeFileId = null;
    activateFile(files[newIdx].id);
  }
  return true;
}

export function renameFile(id, name) {
  const f = files.find(fl => fl.id === id);
  if (f) f.name = name;
}

export function getFiles() { return files; }
export function getActiveFile() { return files.find(f => f.id === activeFileId); }
export function getActiveFileId() { return activeFileId; }

// ── Internal ─────────────────────────────────────────────────────────────────

function saveCurrentFile() {
  const file = files.find(f => f.id === activeFileId);
  if (!file) return;

  file.canvasWidth = DW;
  file.canvasHeight = DH;
  file.assetsSnapshot = saveAllState();
  file.bgColor = getBgColor();
}

function activateFile(id) {
  const file = files.find(f => f.id === id);
  if (!file) return;

  activeFileId = id;

  // Set canvas dimensions
  setCanvasDimensions(file.canvasWidth, file.canvasHeight);
  resizeCanvasElements();

  if (file.assetsSnapshot) {
    // Restore existing file
    restoreAllState(file.assetsSnapshot);
    setBgColor(file.bgColor || '#000000');

    // Restore selected asset into globals
    const selId = getSelectedAssetId();
    if (selId !== null) {
      selectAsset(selId);
    }
  } else {
    // Fresh file — init with default circle shape via ShapeManager
    initFreshFile(file);
  }

  // Clear canvas
  const { dctx } = getCanvasRefs();
  dctx.fillStyle = getBgColor();
  dctx.fillRect(0, 0, W, H);

  if (onSwitch) onSwitch();
}

function initFreshFile(file) {
  const defaultShape = createCircleShape(108);
  const defaultSdf = new DistanceField(defaultShape);
  defaultSdf.compute();
  setShape(defaultShape, defaultSdf);

  // Reset global slider values to defaults
  setFillDensity(0.70);
  setSpeedMult(1.0);
  setGrainSpace(9);
  setStretchPct(0.45);
  setFlowDir(1);

  // Reset node state
  restoreNodeState({
    nodes: [
      { id: 1, name: 'Node 1', angle: -Math.PI * 0.6, handleAngle: -Math.PI * 0.6 - Math.PI / 2, bleed: 0, spread: 1.2, t: 0,
        directionStrength: 0.7, pull: 0.5, fade: 0.3, stretch: 0.5, streamLength: 0.5, linkedAnchors: [] },
      { id: 2, name: 'Node 2', angle: Math.PI * 0.4, handleAngle: Math.PI * 0.4 - Math.PI / 2, bleed: 0, spread: 1.2, t: 0,
        directionStrength: 0.7, pull: 0.5, fade: 0.3, stretch: 0.5, streamLength: 0.5, linkedAnchors: [] },
    ],
    anchors: [],
    nextNodeId: 3,
    nextAnchorId: 1,
    flowDir: 1,
    activeNodeId: null,
    activeAnchorId: null,
    flowMode: 'tangential',
    linearAng: -Math.PI / 2,
    fillDensity: 0.70,
    speedMult: 1.0,
    grainSpace: 9,
    stretchPct: 0.45,
    undoStack: [],
    redoStack: [],
  });

  // Create asset via ShapeManager
  const asset = addAsset(defaultShape, defaultSdf, 'Circle');

  // Init particles
  const state = getState();
  const cnt = Math.min(Math.round(500 + state.fillDensity * 4500), 2000);
  initParticles(defaultShape, defaultSdf, cnt);

  // Save into asset
  asset.nodeState = saveNodeStateWithShape();
  saveToSnapshot(asset.particles);

  selectAsset(asset.id);
  setBgColor('#000000');
}

export function updateActiveFileDimensions(w, h) {
  const file = files.find(f => f.id === activeFileId);
  if (!file) return;
  file.canvasWidth = w;
  file.canvasHeight = h;
}
