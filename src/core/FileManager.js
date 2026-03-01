import { DW, DH, setCanvasDimensions, resizeCanvasElements, getCanvasRefs, W, H } from '../utils/canvas.js';
import { restoreNodeState, restoreAnchorState, getState, setFillDensity, setSpeedMult, setGrainSpace, setStretchPct, setFlowDir, setShape, clearShape, saveNodeStateWithShape } from '../nodes/NodeManager.js';
import { init as initParticles, reinit as reinitParticles, saveToSnapshot } from './ParticleSystem.js';
import { createCircleShape } from './ShapeParser.js';
import { DistanceField } from './DistanceField.js';
import {
  saveAllState, restoreAllState, getBgColor, setBgColor,
  addAsset, selectAsset, getSelectedAssetId, deselectAll,
  serializeState, deserializeState,
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
  // Start completely blank — no shapes, no nodes, no anchors
  clearShape();

  // Reset global slider values to defaults
  setFillDensity(0.70);
  setSpeedMult(1.0);
  setGrainSpace(9);
  setStretchPct(0.45);
  setFlowDir(1);

  // Reset node state to empty
  restoreNodeState({
    nodes: [
      { id: 1, name: 'Node 1', angle: -Math.PI * 0.6, handleAngle: -Math.PI * 0.6 - Math.PI / 2, bleed: 0, spread: 1.2, t: 0,
        directionStrength: 0.7, pull: 0.5, fade: 0.3, stretch: 0.5, streamLength: 0.5, linkedAnchors: [] },
      { id: 2, name: 'Node 2', angle: Math.PI * 0.4, handleAngle: Math.PI * 0.4 - Math.PI / 2, bleed: 0, spread: 1.2, t: 0,
        directionStrength: 0.7, pull: 0.5, fade: 0.3, stretch: 0.5, streamLength: 0.5, linkedAnchors: [] },
    ],
    nextNodeId: 3,
    flowDir: 1,
    activeNodeId: null,
    flowMode: 'tangential',
    linearAng: -Math.PI / 2,
    fillDensity: 0.70,
    speedMult: 1.0,
    grainSpace: 9,
    stretchPct: 0.45,
    particleColor: '#ffffff',
    undoStack: [],
    redoStack: [],
  });

  // Reset anchors
  restoreAnchorState({ anchors: [], nextAnchorId: 1, activeAnchorId: null });

  // No assets — user adds shapes manually
  deselectAll();
  setBgColor('#000000');
}

export function updateActiveFileDimensions(w, h) {
  const file = files.find(f => f.id === activeFileId);
  if (!file) return;
  file.canvasWidth = w;
  file.canvasHeight = h;
}

// ── Project export/import (.flowasset) ────────────────────────────────────────

const AUTOSAVE_KEY = 'flow-dither-autosave';

export function exportProject() {
  // Save current file state
  saveCurrentFile();

  // Serialize each file's assets via ShapeManager
  const serializedFiles = files.map(f => {
    // For the active file, assets are already saved via saveCurrentFile().
    // For non-active files, use their stored assetsSnapshot and serialize it.
    let serializedAssets;
    if (f.id === activeFileId) {
      // Currently active — serializeState() captures live globals
      serializedAssets = serializeState();
    } else if (f.assetsSnapshot) {
      // Non-active file: restore its snapshot, serialize, restore active
      restoreAllState(f.assetsSnapshot);
      serializedAssets = serializeState();
      // Restore active file back
      const activeFile = files.find(fl => fl.id === activeFileId);
      if (activeFile && activeFile.assetsSnapshot) {
        restoreAllState(activeFile.assetsSnapshot);
        const selId = getSelectedAssetId();
        if (selId !== null) selectAsset(selId);
      }
    } else {
      serializedAssets = null;
    }

    return {
      id: f.id,
      name: f.name,
      canvasWidth: f.canvasWidth,
      canvasHeight: f.canvasHeight,
      bgColor: f.bgColor,
      assetsSnapshot: serializedAssets,
    };
  });

  return {
    format: 'flowasset',
    version: 1,
    files: serializedFiles,
    activeFileId,
  };
}

export function importProject(data) {
  if (!data || data.format !== 'flowasset' || data.version !== 1) {
    throw new Error('Invalid .flowasset file');
  }

  // Rebuild files array
  files = data.files.map(f => ({
    id: f.id,
    name: f.name || 'Untitled',
    canvasWidth: (Number.isFinite(f.canvasWidth) && f.canvasWidth > 0) ? f.canvasWidth : 600,
    canvasHeight: (Number.isFinite(f.canvasHeight) && f.canvasHeight > 0) ? f.canvasHeight : 600,
    assetsSnapshot: null, // will be rebuilt below
    bgColor: f.bgColor || '#000000',
  }));

  // Find the max file ID for nextFileId
  nextFileId = Math.max(...files.map(f => f.id)) + 1;

  // Deserialize each file's assets snapshot
  for (const fd of data.files) {
    const file = files.find(f => f.id === fd.id);
    if (!file || !fd.assetsSnapshot) continue;

    // Temporarily set canvas dims for SDF computation
    setCanvasDimensions(file.canvasWidth, file.canvasHeight);

    // Deserialize: rebuilds shapes (raycast), SDFs, typed arrays
    deserializeState(fd.assetsSnapshot);
    // Save as a live snapshot for this file
    file.assetsSnapshot = saveAllState();
  }

  // Activate the saved active file
  activeFileId = null; // force re-activation
  const targetId = data.activeFileId || files[0].id;
  activateFile(targetId);
}

export function autoSaveToLocalStorage() {
  try {
    const data = exportProject();
    data._blankStart = true; // Mark as new-version autosave
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch (e) {
    // Silently fail — localStorage may be full or unavailable
  }
}

export function loadAutoSave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    // Skip autosave from older versions that started with default shapes
    if (data._blankStart) {
      importProject(data);
      return true;
    }
    // Old autosave without blank-start flag — discard it
    localStorage.removeItem(AUTOSAVE_KEY);
    return false;
  } catch (e) {
    // Corrupt autosave — remove it
    localStorage.removeItem(AUTOSAVE_KEY);
    return false;
  }
}

export function clearAutoSave() {
  localStorage.removeItem(AUTOSAVE_KEY);
}
