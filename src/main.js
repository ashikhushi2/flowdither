import './style.css';
import { initCanvas, toDither, CX, CY, W, H, DW, DH, setCanvasDimensions, resizeCanvasElements, resize } from './utils/canvas.js';
import { getCanvasRefs } from './utils/canvas.js';
import { normA } from './utils/math.js';
import {
  init as initParticles, update as updateParticles,
  clearFrame, renderAssetParticles, loadFromSnapshot, saveToSnapshot,
  reinit as reinitParticles, translateParticles, scaleParticles, rotateParticles,
} from './core/ParticleSystem.js';
import { renderOverlay } from './nodes/NodeOverlay.js';
import {
  getState, setActiveId, setDragState, hitTest, handleDrag, nPos,
  addNode, deleteActiveNode,
  addNodeAtBestGap, selectNodeByIndex, togglePaused,
  setShape, setActiveAnchorId, getPlacingAnchor, setPlacingAnchor, clearPlacingAnchor,
  addAnchor, linkAnchorToNode, deleteAnchor,
  translateAnchors, rotateNodesAndAnchors, scaleAnchors,
  saveNodeStateWithShape, restoreNodeStateWithShape, restoreNodeState,
} from './nodes/NodeManager.js';
import { buildPanel, initGlobalControls } from './ui/Panel.js';
import { initUploadHandler, setOnShapeChange } from './ui/UploadHandler.js';
import { initExportModal, openExportModal } from './ui/ExportModal.js';
import { createCircleShape } from './core/ShapeParser.js';
import { DistanceField } from './core/DistanceField.js';
import { initFileManager, setOnSwitch, updateActiveFileDimensions } from './core/FileManager.js';
import { buildTabBar } from './ui/TabBar.js';
import {
  addAsset, removeAsset, selectAsset, deselectAll,
  saveCurrentAssetLiveState, getSelectedAssetId, getAllAssets, getAssetById,
  getBgColor, setBgColor, getMaxPerAsset,
  pushGlobalUndo, globalUndo, globalRedo,
} from './core/ShapeManager.js';

// ── Fresh default node state (used for new assets) ───────────────────────────
function createDefaultNodeState() {
  return {
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
  };
}

// ── Init ─────────────────────────────────────────────────────────────────────
initCanvas();
initGlobalControls();
initUploadHandler();
initExportModal();

// ── Wire Panel callbacks ──────────────────────────────────────────────────────
window._openExportModal = (mode) => openExportModal(mode);
window._syncAfterShapeSelect = () => {
  syncGlobalSlidersFromState();
  syncPositionSliders(0, 0);
  syncScaleRotateSliders(100, 0);
};

// ── File Manager ─────────────────────────────────────────────────────────────
setOnSwitch(() => {
  syncGlobalSlidersFromState();
  buildPanel();
  buildTabBar();
  renderOverlay();
  updateCanvasSizeDropdown();
  updateExportResolutionLabels();
  updatePositionSliderRanges();
  syncPositionSliders(0, 0);
  syncScaleRotateSliders(100, 0);
  syncBgColorControls();
});

initFileManager();
buildTabBar();

// ── Load default circle shape via ShapeManager ───────────────────────────────
const defaultShape = createCircleShape(108);
const defaultSdf = new DistanceField(defaultShape);
defaultSdf.compute();

// Create first asset
const firstAsset = addAsset(defaultShape, defaultSdf, 'Circle');

// Set up NodeManager globals for this asset
setShape(defaultShape, defaultSdf);

// Init particles into global arrays
const state0 = getState();
const initCount = Math.min(Math.round(500 + state0.fillDensity * 4500), getMaxPerAsset());
initParticles(defaultShape, defaultSdf, initCount);

// Save initial state into asset
firstAsset.nodeState = saveNodeStateWithShape();
saveToSnapshot(firstAsset.particles);

// Select it
selectAsset(firstAsset.id);

// Clear dither canvas to black initially
{
  const { dctx } = getCanvasRefs();
  dctx.fillStyle = getBgColor();
  dctx.fillRect(0, 0, W, H);
}

// Reinit particles when SVG is uploaded — now adds a new asset
setOnShapeChange((shape, sdf, name) => {
  // 0. Push undo before adding the shape
  pushGlobalUndo();

  // 1. Save current asset safely BEFORE touching any globals
  deselectAll();

  // 2. Reset NodeManager to fresh default nodes, then set the new shape
  //    (setShape recalculates node t-values for the new shape boundary)
  restoreNodeState(createDefaultNodeState());
  setShape(shape, sdf);

  // 3. Create asset & init particles
  const asset = addAsset(shape, sdf, name || 'SVG');
  const s = getState();
  const cnt = Math.min(Math.round(500 + s.fillDensity * 4500), getMaxPerAsset());
  initParticles(shape, sdf, cnt);

  // 4. Save fresh state into asset
  asset.nodeState = saveNodeStateWithShape();
  saveToSnapshot(asset.particles);

  // 5. Select it (nothing is currently selected, so no contamination)
  selectAsset(asset.id);

  // Clear canvas
  const { dctx } = getCanvasRefs();
  dctx.fillStyle = getBgColor();
  dctx.fillRect(0, 0, W, H);

  syncPositionSliders(0, 0);
  syncScaleRotateSliders(100, 0);
  syncGlobalSlidersFromState();
  buildPanel();
  renderOverlay();
});

// Pause indicator element
const pauseDiv = document.createElement('div');
pauseDiv.id = 'pause-indicator';
pauseDiv.textContent = 'PAUSED';
pauseDiv.style.display = 'none';
document.body.appendChild(pauseDiv);

// ── Canvas size dropdown ─────────────────────────────────────────────────────
const canvasSizeSel = document.getElementById('canvas-size-sel');
canvasSizeSel.addEventListener('change', () => {
  const [w, h] = canvasSizeSel.value.split('x').map(Number);

  const oldCX = DW / 2;
  const oldCY = DH / 2;

  setCanvasDimensions(w, h);
  resizeCanvasElements();
  updateActiveFileDimensions(w, h);

  // Iterate ALL assets, translate each shape to new center, rebuild SDFs
  const newCX = w / 2;
  const newCY = h / 2;
  const dx = newCX - oldCX;
  const dy = newCY - oldCY;

  // Save current selection first
  saveCurrentAssetLiveState();

  for (const asset of getAllAssets()) {
    // Load asset state
    if (asset.nodeState) {
      restoreNodeStateWithShape(asset.nodeState);
    }
    loadFromSnapshot(asset.particles);

    const s = getState();
    if (s.currentShape) {
      s.currentShape.translate(dx, dy);
      const newSdf = new DistanceField(s.currentShape);
      newSdf.compute();
      setShape(s.currentShape, newSdf);
      translateParticles(dx, dy, s.currentShape, newSdf);
    }

    // Save back
    asset.nodeState = saveNodeStateWithShape();
    saveToSnapshot(asset.particles);
    // Keep asset.shape/sdf in sync
    asset.shape = asset.nodeState.currentShape;
    asset.sdf = asset.nodeState.currentSDF;
  }

  // Restore selected asset back into globals
  const selId = getSelectedAssetId();
  if (selId !== null) {
    const selAsset = getAssetById(selId);
    if (selAsset) {
      restoreNodeStateWithShape(selAsset.nodeState);
      loadFromSnapshot(selAsset.particles);
    }
  }

  // Clear canvas
  const { dctx } = getCanvasRefs();
  dctx.fillStyle = getBgColor();
  dctx.fillRect(0, 0, W, H);

  updatePositionSliderRanges();
  syncPositionSliders(0, 0);
  syncScaleRotateSliders(100, 0);

  renderOverlay();
  updateExportResolutionLabels();
});

// ── Shape position sliders ───────────────────────────────────────────────────
let shapeOffsetX = 0, shapeOffsetY = 0;

const posXSl = document.getElementById('pos-x-sl');
const posXVal = document.getElementById('pos-x-val');
const posYSl = document.getElementById('pos-y-sl');
const posYVal = document.getElementById('pos-y-val');

function handlePositionSliderPreview() {
  const newX = +posXSl.value;
  const newY = +posYSl.value;
  posXVal.textContent = newX;
  posYVal.textContent = newY;
  const dxVis = newX - shapeOffsetX;
  const dyVis = newY - shapeOffsetY;
  renderOverlay({ dx: dxVis, dy: dyVis, scale: 1, rotate: 0, cx: 0, cy: 0 });
}

function commitPositionSliders() {
  const newX = +posXSl.value;
  const newY = +posYSl.value;
  posXVal.textContent = newX;
  posYVal.textContent = newY;

  const s = getState();
  if (!s.currentShape) return;

  const dx = newX - shapeOffsetX;
  const dy = newY - shapeOffsetY;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

  shapeOffsetX = newX;
  shapeOffsetY = newY;

  s.currentShape.translate(dx, dy);
  const newSdf = new DistanceField(s.currentShape);
  newSdf.compute();
  setShape(s.currentShape, newSdf);
  translateParticles(dx, dy, s.currentShape, newSdf);
  translateAnchors(dx, dy);

  const { dctx } = getCanvasRefs();
  const imgData = dctx.getImageData(0, 0, W, H);
  dctx.fillStyle = getBgColor();
  dctx.fillRect(0, 0, W, H);
  dctx.putImageData(imgData, dx * (W / DW), dy * (H / DH));

  renderOverlay();
}

posXSl.addEventListener('pointerdown', () => pushGlobalUndo());
posYSl.addEventListener('pointerdown', () => pushGlobalUndo());
posXSl.addEventListener('input', handlePositionSliderPreview);
posYSl.addEventListener('input', handlePositionSliderPreview);
posXSl.addEventListener('change', commitPositionSliders);
posYSl.addEventListener('change', commitPositionSliders);

function syncPositionSliders(ox, oy) {
  shapeOffsetX = ox;
  shapeOffsetY = oy;
  if (posXSl) { posXSl.value = Math.round(ox); posXVal.textContent = Math.round(ox); }
  if (posYSl) { posYSl.value = Math.round(oy); posYVal.textContent = Math.round(oy); }
}

function updatePositionSliderRanges() {
  const halfW = Math.round(DW / 2);
  const halfH = Math.round(DH / 2);
  if (posXSl) { posXSl.min = -halfW; posXSl.max = halfW; }
  if (posYSl) { posYSl.min = -halfH; posYSl.max = halfH; }
}
updatePositionSliderRanges();

// ── Shape scale/rotate sliders ──────────────────────────────────────────────
let shapeScale = 100, shapeRotation = 0;

const scaleSl = document.getElementById('scale-sl');
const scaleVal = document.getElementById('scale-val');
const rotateSl = document.getElementById('rotate-sl');
const rotateVal = document.getElementById('rotate-val');

function getShapeCenter() {
  const s = getState();
  if (!s.currentShape) return { cx: CX, cy: CY };
  const b = s.currentShape.bounds;
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

function handleScaleRotatePreview() {
  const newScale = +scaleSl.value;
  const newRotation = +rotateSl.value;
  scaleVal.textContent = newScale + '%';
  rotateVal.textContent = newRotation + '\u00B0';

  const deltaScale = newScale / shapeScale;
  const deltaRotate = (newRotation - shapeRotation) * Math.PI / 180;
  const { cx, cy } = getShapeCenter();
  renderOverlay({ dx: 0, dy: 0, scale: deltaScale, rotate: deltaRotate, cx, cy });
}

function commitScaleRotate() {
  const newScale = +scaleSl.value;
  const newRotation = +rotateSl.value;
  scaleVal.textContent = newScale + '%';
  rotateVal.textContent = newRotation + '\u00B0';

  const s = getState();
  if (!s.currentShape) return;

  const deltaScale = newScale / shapeScale;
  const deltaRotate = (newRotation - shapeRotation) * Math.PI / 180;
  if (Math.abs(deltaScale - 1) < 0.001 && Math.abs(deltaRotate) < 0.001) return;

  const { cx, cy } = getShapeCenter();

  if (Math.abs(deltaScale - 1) >= 0.001) {
    s.currentShape.scale(deltaScale, cx, cy);
    scaleAnchors(deltaScale, cx, cy);
  }
  if (Math.abs(deltaRotate) >= 0.001) {
    s.currentShape.rotate(deltaRotate, cx, cy);
    rotateNodesAndAnchors(deltaRotate, cx, cy);
  }

  const newSdf = new DistanceField(s.currentShape);
  newSdf.compute();
  setShape(s.currentShape, newSdf, true);

  for (const n of s.nodes) {
    const info = s.currentShape.getNearestBoundary(nPos(n).x, nPos(n).y);
    n.t = info.t;
  }

  if (Math.abs(deltaScale - 1) >= 0.001) {
    scaleParticles(deltaScale, cx, cy, s.currentShape, newSdf);
  }
  if (Math.abs(deltaRotate) >= 0.001) {
    rotateParticles(deltaRotate, cx, cy, s.currentShape, newSdf);
  }

  const { dctx } = getCanvasRefs();
  dctx.fillStyle = getBgColor();
  dctx.fillRect(0, 0, W, H);

  shapeScale = newScale;
  shapeRotation = newRotation;

  buildPanel();
  renderOverlay();
}

scaleSl.addEventListener('pointerdown', () => pushGlobalUndo());
rotateSl.addEventListener('pointerdown', () => pushGlobalUndo());
scaleSl.addEventListener('input', handleScaleRotatePreview);
rotateSl.addEventListener('input', handleScaleRotatePreview);
scaleSl.addEventListener('change', commitScaleRotate);
rotateSl.addEventListener('change', commitScaleRotate);

function syncScaleRotateSliders(scale, rotation) {
  shapeScale = scale;
  shapeRotation = rotation;
  if (scaleSl) { scaleSl.value = scale; scaleVal.textContent = scale + '%'; }
  if (rotateSl) { rotateSl.value = rotation; rotateVal.textContent = rotation + '\u00B0'; }
}

// ── BG color sync ─────────────────────────────────────────────────────────────
function syncBgColorControls() {
  const picker = document.getElementById('bg-color-picker');
  const hex = document.getElementById('bg-color-hex');
  if (picker) picker.value = getBgColor();
  if (hex) hex.value = getBgColor();
}

// ── Sync helpers ─────────────────────────────────────────────────────────────
function syncGlobalSlidersFromState() {
  // Fill/speed/grain/trail/direction are now in shape popover — no global sliders to sync
}

function updateCanvasSizeDropdown() {
  const sel = document.getElementById('canvas-size-sel');
  if (!sel) return;
  const val = `${DW}x${DH}`;
  for (const opt of sel.options) {
    if (opt.value === val) { sel.value = val; return; }
  }
  const opt = document.createElement('option');
  opt.value = val;
  opt.textContent = `${DW} \u00D7 ${DH}`;
  sel.appendChild(opt);
  sel.value = val;
}

function updateExportResolutionLabels() {
  const sel = document.getElementById('export-resolution');
  if (!sel) return;
  for (const opt of sel.options) {
    const mult = +opt.value;
    opt.textContent = `${mult}x (${DW * mult}\u00D7${DH * mult})`;
  }
}

updateExportResolutionLabels();

// ── Drag handling ────────────────────────────────────────────────────────────
let shapeDrag = null;
const oc = document.getElementById('overlay-canvas');

oc.addEventListener('mousedown', e => {
  const pos = toDither(e);

  // Anchor placement mode
  const placingFor = getPlacingAnchor();
  if (placingFor !== null) {
    pushGlobalUndo();
    const a = addAnchor(pos.x, pos.y);
    if (placingFor > 0) linkAnchorToNode(placingFor, a.id);
    clearPlacingAnchor();
    setActiveAnchorId(a.id);
    buildPanel();
    renderOverlay();
    return;
  }

  const selId = getSelectedAssetId();

  // If a shape is selected, try hit test on its nodes/handles/ring first
  if (selId !== null) {
    const hit = hitTest(pos);

    if (hit?.type === 'anchor') {
      pushGlobalUndo();
      setDragState({ type: 'anchor', id: hit.id });
      setActiveAnchorId(hit.id);
      setActiveId(null);
      buildPanel();
      renderOverlay();
      return;
    } else if (hit?.type === 'node' || hit?.type === 'handle') {
      pushGlobalUndo();
      setDragState({ type: hit.type, id: hit.id });
      setActiveId(hit.id);
      setActiveAnchorId(null);
      buildPanel();
      renderOverlay();
      return;
    } else if (hit?.type === 'ring') {
      pushGlobalUndo();
      setActiveAnchorId(null);
      const state = getState();
      if (state.currentShape) {
        const shape = state.currentShape;
        const info = shape.getNearestBoundary(pos.x, pos.y);
        const angle = Math.atan2(info.point.y - CY, info.point.x - CX);
        const nd = addNode(angle, info.t);
        setDragState({ type: 'node', id: nd.id });
      } else {
        const ang = Math.atan2(pos.y - CY, pos.x - CX);
        const nd = addNode(ang, 0);
        setDragState({ type: 'node', id: nd.id });
      }
      buildPanel();
      renderOverlay();
      return;
    }

    // Check if click is inside selected shape — start drag
    const st = getState();
    if (st.currentSDF && st.currentSDF.sample(pos.x, pos.y) < 0) {
      pushGlobalUndo();
      shapeDrag = { startX: pos.x, startY: pos.y, dx: 0, dy: 0 };
      setActiveId(null);
      setActiveAnchorId(null);
      buildPanel();
      renderOverlay();
      return;
    }
  }

  // Check if click is inside any other shape → select it
  for (const asset of getAllAssets()) {
    if (asset.id === selId) continue;
    if (asset.particles.sdf && asset.particles.sdf.sample(pos.x, pos.y) < 0) {
      selectAsset(asset.id);
      syncGlobalSlidersFromState();
      syncPositionSliders(0, 0);
      syncScaleRotateSliders(100, 0);
      buildPanel();
      renderOverlay();
      return;
    }
  }

  // Click on empty canvas → deselect
  if (selId !== null) {
    deselectAll();
    buildPanel();
    renderOverlay();
    return;
  }

  setActiveId(null);
  setActiveAnchorId(null);
  buildPanel();
  renderOverlay();
});

oc.addEventListener('mousemove', e => {
  const pos = toDither(e);

  if (shapeDrag) {
    shapeDrag.dx = pos.x - shapeDrag.startX;
    shapeDrag.dy = pos.y - shapeDrag.startY;
    renderOverlay({ dx: shapeDrag.dx, dy: shapeDrag.dy, scale: 1, rotate: 0, cx: 0, cy: 0 });
    return;
  }

  const state = getState();
  if (!state.dragState) return;
  handleDrag(pos);

  if (state.dragState.type === 'handle') {
    const pop = document.getElementById('prop-popover');
    if (pop) {
      const n = getState().nodes.find(nd => nd.id === state.dragState.id);
      if (n) {
        const flowDir = getState().flowDir;
        const tanDirAng = Math.atan2(Math.cos(n.angle) * flowDir, -Math.sin(n.angle) * flowDir);
        const relDeg = Math.round(normA(n.handleAngle - tanDirAng) * 180 / Math.PI);
        const rsl = pop.querySelector(`.rsl[data-id="${n.id}"]`);
        if (rsl) rsl.value = relDeg;
        const rv = document.getElementById(`rv-${n.id}`);
        if (rv) rv.textContent = relDeg === 0 ? 'tangent' : (relDeg > 0 ? `+${relDeg}\u00B0` : `${relDeg}\u00B0`);
        const bsl = pop.querySelector(`.bsl[data-id="${n.id}"]`);
        if (bsl) bsl.value = Math.round(n.bleed * 100);
        const bv = document.getElementById(`bv-${n.id}`);
        if (bv) bv.textContent = Math.round(n.bleed * 100) + '%';
      }
    }
  }
  renderOverlay();
});

oc.addEventListener('mouseup', () => {
  if (shapeDrag) {
    const { dx, dy } = shapeDrag;
    shapeDrag = null;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      const s = getState();
      if (s.currentShape) {
        s.currentShape.translate(dx, dy);
        const newSdf = new DistanceField(s.currentShape);
        newSdf.compute();
        setShape(s.currentShape, newSdf);
        translateParticles(dx, dy, s.currentShape, newSdf);
        translateAnchors(dx, dy);

        const { dctx } = getCanvasRefs();
        const imgData = dctx.getImageData(0, 0, W, H);
        dctx.fillStyle = getBgColor();
        dctx.fillRect(0, 0, W, H);
        dctx.putImageData(imgData, dx * (W / DW), dy * (H / DH));

        const b = s.currentShape.bounds;
        const shapeCX = (b.minX + b.maxX) / 2;
        const shapeCY = (b.minY + b.maxY) / 2;
        syncPositionSliders(shapeCX - CX, shapeCY - CY);
      }
    }
    renderOverlay();
    return;
  }
  setDragState(null);
});
oc.addEventListener('mouseleave', () => {
  if (shapeDrag) {
    shapeDrag = null;
    renderOverlay();
    return;
  }
  setDragState(null);
});

// ── Touch support ────────────────────────────────────────────────────────────
function t2m(e) {
  return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
}
oc.addEventListener('touchstart', e => {
  e.preventDefault();
  oc.dispatchEvent(new MouseEvent('mousedown', t2m(e)));
}, { passive: false });
oc.addEventListener('touchmove', e => {
  e.preventDefault();
  oc.dispatchEvent(new MouseEvent('mousemove', t2m(e)));
}, { passive: false });
oc.addEventListener('touchend', () => oc.dispatchEvent(new MouseEvent('mouseup')));

// ── Shape-level undo restore helper ──────────────────────────────────────────
function restoreAfterUndo() {
  // After globalUndo/globalRedo, restoreAllState has rebuilt assets + selectedAssetId.
  // Restore the selected asset's state into NodeManager/ParticleSystem globals.
  const selId = getSelectedAssetId();
  if (selId !== null) {
    const selAsset = getAssetById(selId);
    if (selAsset) {
      if (selAsset.nodeState) restoreNodeStateWithShape(selAsset.nodeState);
      loadFromSnapshot(selAsset.particles);
    }
  }
  // Clear canvas so trails rebuild cleanly
  const { dctx } = getCanvasRefs();
  dctx.fillStyle = getBgColor();
  dctx.fillRect(0, 0, W, H);
  syncGlobalSlidersFromState();
  syncPositionSliders(0, 0);
  syncScaleRotateSliders(100, 0);
  syncBgColorControls();
  buildPanel();
  renderOverlay();
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const st = getState();
    const selId = getSelectedAssetId();
    if (st.activeAnchorId !== null) {
      pushGlobalUndo();
      deleteAnchor(st.activeAnchorId);
    } else if (st.activeId !== null) {
      pushGlobalUndo();
      deleteActiveNode();
    } else if (selId !== null) {
      // No active node/anchor — delete the whole shape
      pushGlobalUndo();
      removeAsset(selId);
      const { dctx } = getCanvasRefs();
      dctx.fillStyle = getBgColor();
      dctx.fillRect(0, 0, W, H);
    }
    buildPanel();
    renderOverlay();
  } else if (e.key === 'Escape') {
    const placing = getPlacingAnchor();
    if (placing !== null) {
      clearPlacingAnchor();
      buildPanel();
      renderOverlay();
    } else if (getSelectedAssetId() !== null) {
      deselectAll();
      buildPanel();
      renderOverlay();
    }
  } else if (e.key === ' ') {
    e.preventDefault();
    const p = togglePaused();
    pauseDiv.style.display = p ? 'block' : 'none';
  } else if (e.key === '+' || e.key === '=') {
    if (getSelectedAssetId() !== null) {
      pushGlobalUndo();
      addNodeAtBestGap();
      buildPanel();
      renderOverlay();
    }
  } else if (e.key === '-' || e.key === '_') {
    if (getSelectedAssetId() !== null) {
      pushGlobalUndo();
      deleteActiveNode();
      buildPanel();
      renderOverlay();
    }
  } else if (e.key >= '1' && e.key <= '9') {
    if (getSelectedAssetId() !== null) {
      selectNodeByIndex(parseInt(e.key) - 1);
      buildPanel();
      renderOverlay();
    }
  } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault();
    if (globalRedo()) {
      restoreAfterUndo();
    }
  } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (globalUndo()) {
      restoreAfterUndo();
    }
  }
});

// ── Animation loop ───────────────────────────────────────────────────────────
let last = 0;

function frame(ts) {
  const state = getState();

  if (!state.paused) {
    const dt = Math.min((ts - last) / 1000, 0.05);
    const { dctx } = getCanvasRefs();

    // Clear canvas once with trail effect using bg color
    clearFrame(dctx, W, H, getBgColor(), state.stretchPct);

    // Save current selected asset state before iterating
    const selId = getSelectedAssetId();

    // Preserve UI interaction state — restoreNodeState nukes these every call
    const savedState = getState();
    const savedDragState = savedState.dragState;
    const savedActiveId = savedState.activeId;
    const savedActiveAnchorId = savedState.activeAnchorId;
    const savedPlacing = savedState.placingAnchorForNode;

    if (selId !== null) {
      saveCurrentAssetLiveState();
    }

    // Iterate all assets: restore → update → save → render
    for (const asset of getAllAssets()) {
      if (asset.nodeState) {
        restoreNodeStateWithShape(asset.nodeState);
      }
      loadFromSnapshot(asset.particles);

      updateParticles(dt);

      saveToSnapshot(asset.particles);
      asset.nodeState = saveNodeStateWithShape();

      renderAssetParticles(dctx, W, H);
    }

    // Restore selected asset state back into globals for UI/overlay
    if (selId !== null) {
      const selAsset = getAssetById(selId);
      if (selAsset) {
        restoreNodeStateWithShape(selAsset.nodeState);
        loadFromSnapshot(selAsset.particles);
      }
    }

    // Restore UI interaction state that restoreNodeState cleared
    setDragState(savedDragState);
    setActiveId(savedActiveId);
    setActiveAnchorId(savedActiveAnchorId);
    if (savedPlacing !== null) setPlacingAnchor(savedPlacing);
  }
  last = ts;
  requestAnimationFrame(frame);
}

// ── Start ────────────────────────────────────────────────────────────────────
buildPanel();
renderOverlay();
syncBgColorControls();
requestAnimationFrame(ts => { last = ts; requestAnimationFrame(frame); });
