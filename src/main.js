import './style.css';
import { initCanvas, toDither, CX, CY, W, H } from './utils/canvas.js';
import { getCanvasRefs } from './utils/canvas.js';
import { normA } from './utils/math.js';
import { init as initParticles, update as updateParticles, renderFrame } from './core/ParticleSystem.js';
import { renderOverlay } from './nodes/NodeOverlay.js';
import {
  getState, setActiveId, setDragState, hitTest, handleDrag,
  addNode, pushUndo, undo, redo, deleteActiveNode,
  addNodeAtBestGap, selectNodeByIndex, togglePaused,
  setShape, setActiveAnchorId, getPlacingAnchor, clearPlacingAnchor,
  addAnchor, linkAnchorToNode, deleteAnchor,
} from './nodes/NodeManager.js';
import { buildPanel, initGlobalControls } from './ui/Panel.js';
import { initUploadHandler, setOnShapeChange } from './ui/UploadHandler.js';
import { initExportModal } from './ui/ExportModal.js';
import { createCircleShape } from './core/ShapeParser.js';
import { DistanceField } from './core/DistanceField.js';

// ── Init ─────────────────────────────────────────────────────────────────────
initCanvas();
initGlobalControls();
initUploadHandler();
initExportModal();

// ── Load default circle shape ────────────────────────────────────────────────
const defaultShape = createCircleShape();
const defaultSdf = new DistanceField(defaultShape);
defaultSdf.compute();
setShape(defaultShape, defaultSdf);

// Init particle system with default shape
const state0 = getState();
const initCount = Math.round(500 + state0.fillDensity * 4500);
initParticles(defaultShape, defaultSdf, initCount);

// Clear dither canvas to black initially
const { dctx } = getCanvasRefs();
dctx.fillStyle = 'black';
dctx.fillRect(0, 0, W, H);

// Reinit particles when SVG is uploaded
setOnShapeChange(() => {
  const s = getState();
  if (s.currentShape && s.currentSDF) {
    const cnt = Math.round(500 + s.fillDensity * 4500);
    initParticles(s.currentShape, s.currentSDF, cnt);
    // Clear canvas for new shape
    dctx.fillStyle = 'black';
    dctx.fillRect(0, 0, W, H);
  }
});

// Pause indicator element
const pauseDiv = document.createElement('div');
pauseDiv.id = 'pause-indicator';
pauseDiv.textContent = 'PAUSED';
pauseDiv.style.display = 'none';
document.body.appendChild(pauseDiv);

// ── Drag handling ────────────────────────────────────────────────────────────
const oc = document.getElementById('overlay-canvas');

oc.addEventListener('mousedown', e => {
  const pos = toDither(e);

  // Anchor placement mode
  const placingFor = getPlacingAnchor();
  if (placingFor !== null) {
    pushUndo();
    const a = addAnchor(pos.x, pos.y);
    if (placingFor > 0) linkAnchorToNode(placingFor, a.id);
    clearPlacingAnchor();
    setActiveAnchorId(a.id);
    buildPanel();
    renderOverlay();
    return;
  }

  const hit = hitTest(pos);

  if (hit?.type === 'anchor') {
    pushUndo();
    setDragState({ type: 'anchor', id: hit.id });
    setActiveAnchorId(hit.id);
    setActiveId(null);
  } else if (hit?.type === 'node' || hit?.type === 'handle') {
    pushUndo();
    setDragState({ type: hit.type, id: hit.id });
    setActiveId(hit.id);
    setActiveAnchorId(null);
  } else if (hit?.type === 'ring') {
    pushUndo();
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
  } else {
    setActiveId(null);
    setActiveAnchorId(null);
  }
  buildPanel();
  renderOverlay();
});

oc.addEventListener('mousemove', e => {
  const state = getState();
  if (!state.dragState) return;
  const pos = toDither(e);
  handleDrag(pos);

  // Sync popover sliders during handle drag (if popover is open for this node)
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

oc.addEventListener('mouseup', () => setDragState(null));
oc.addEventListener('mouseleave', () => setDragState(null));

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

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Don't handle if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    pushUndo();
    const st = getState();
    if (st.activeAnchorId !== null) {
      deleteAnchor(st.activeAnchorId);
    } else {
      deleteActiveNode();
    }
    buildPanel();
    renderOverlay();
  } else if (e.key === 'Escape') {
    const placing = getPlacingAnchor();
    if (placing !== null) {
      clearPlacingAnchor();
      buildPanel();
      renderOverlay();
    }
  } else if (e.key === ' ') {
    e.preventDefault();
    const p = togglePaused();
    pauseDiv.style.display = p ? 'block' : 'none';
  } else if (e.key === '+' || e.key === '=') {
    pushUndo();
    addNodeAtBestGap();
    buildPanel();
    renderOverlay();
  } else if (e.key === '-' || e.key === '_') {
    pushUndo();
    deleteActiveNode();
    buildPanel();
    renderOverlay();
  } else if (e.key >= '1' && e.key <= '9') {
    selectNodeByIndex(parseInt(e.key) - 1);
    buildPanel();
    renderOverlay();
  } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault();
    if (redo()) {
      buildPanel();
      renderOverlay();
    }
  } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (undo()) {
      buildPanel();
      renderOverlay();
    }
  }
});

// ── Animation loop ───────────────────────────────────────────────────────────
let last = 0;

function frame(ts) {
  const state = getState();

  if (!state.paused) {
    const dt = Math.min((ts - last) / 1000, 0.05);
    updateParticles(dt);
    renderFrame();
  }
  last = ts;
  requestAnimationFrame(frame);
}

// ── Start ────────────────────────────────────────────────────────────────────
buildPanel();
renderOverlay();
requestAnimationFrame(ts => { last = ts; requestAnimationFrame(frame); });
