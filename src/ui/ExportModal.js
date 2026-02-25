import { update as updateParticles, loadFromSnapshot, saveToSnapshot, renderAssetParticles, clearFrame } from '../core/ParticleSystem.js';
import { restoreNodeStateWithShape, saveNodeStateWithShape } from '../nodes/NodeManager.js';
import { getState } from '../nodes/NodeManager.js';
import { DW, DH } from '../utils/canvas.js';
import { getAllAssets, getSelectedAssetId, getAssetById, getBgColor, saveCurrentAssetLiveState } from '../core/ShapeManager.js';

export function openExportModal(mode) {
  const modal = document.getElementById('export-modal');
  if (!modal) return;
  if (mode === 'shape' && getSelectedAssetId() === null) return;
  modal._exportMode = mode || 'canvas';
  modal.classList.remove('hidden');
}

export function initExportModal() {
  const modal = document.getElementById('export-modal');
  const closeBtn = modal.querySelector('.modal-close');
  const formatSelect = document.getElementById('export-format');
  const bgSelect = document.getElementById('export-bg');
  const bgColor = document.getElementById('export-bg-color');
  const animOptions = modal.querySelector('.anim-options');
  const goBtn = document.getElementById('export-go');

  modal._exportMode = 'canvas';

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  formatSelect.addEventListener('change', () => {
    const isAnim = formatSelect.value !== 'png';
    animOptions.classList.toggle('hidden', !isAnim);
  });

  bgSelect.addEventListener('change', () => {
    bgColor.classList.toggle('hidden', bgSelect.value !== 'custom');
  });

  goBtn.addEventListener('click', () => doExport(modal._exportMode));
}

// ── Static (single-frame) render ─────────────────────────────────────────────

function renderAllAssetsStatic(targetCanvas, resMult, bgColorVal) {
  const ew = DW * resMult;
  const eh = DH * resMult;
  targetCanvas.width = ew;
  targetCanvas.height = eh;
  const ectx = targetCanvas.getContext('2d');

  if (bgColorVal === 'transparent') {
    ectx.clearRect(0, 0, ew, eh);
  } else {
    ectx.fillStyle = bgColorVal || getBgColor();
    ectx.fillRect(0, 0, ew, eh);
  }

  saveCurrentAssetLiveState();

  for (const asset of getAllAssets()) {
    if (asset.nodeState) restoreNodeStateWithShape(asset.nodeState);
    loadFromSnapshot(asset.particles);
    renderAssetParticles(ectx, ew, eh);
  }

  // Restore selected
  const selId = getSelectedAssetId();
  if (selId !== null) {
    const sel = getAssetById(selId);
    if (sel) {
      restoreNodeStateWithShape(sel.nodeState);
      loadFromSnapshot(sel.particles);
    }
  }
}

function renderSelectedAssetStatic(targetCanvas, resMult, bgColorVal) {
  const selId = getSelectedAssetId();
  if (selId === null) return;
  const asset = getAssetById(selId);
  if (!asset) return;

  const ew = DW * resMult;
  const eh = DH * resMult;
  targetCanvas.width = ew;
  targetCanvas.height = eh;
  const ectx = targetCanvas.getContext('2d');

  if (bgColorVal === 'transparent') {
    ectx.clearRect(0, 0, ew, eh);
  } else {
    ectx.fillStyle = bgColorVal || getBgColor();
    ectx.fillRect(0, 0, ew, eh);
  }

  if (asset.nodeState) restoreNodeStateWithShape(asset.nodeState);
  loadFromSnapshot(asset.particles);
  renderAssetParticles(ectx, ew, eh);
}

// ── Animated frame render (with trail effect) ────────────────────────────────
// Matches the live renderer by simulating at 60fps internally.
// Each "step" is one 60fps tick: clearFrame → update all assets → render.

const SIM_FPS = 60;
const SIM_DT = 1 / SIM_FPS;

function simStepAllAssets(ectx, ew, eh, bgHex, stretchPct) {
  clearFrame(ectx, ew, eh, bgHex, stretchPct);

  for (const asset of getAllAssets()) {
    if (asset.nodeState) restoreNodeStateWithShape(asset.nodeState);
    loadFromSnapshot(asset.particles);
    updateParticles(SIM_DT);
    saveToSnapshot(asset.particles);
    asset.nodeState = saveNodeStateWithShape();
    renderAssetParticles(ectx, ew, eh);
  }
}

function simStepSelectedAsset(ectx, ew, eh, bgHex, stretchPct, asset) {
  clearFrame(ectx, ew, eh, bgHex, stretchPct);

  if (asset.nodeState) restoreNodeStateWithShape(asset.nodeState);
  loadFromSnapshot(asset.particles);
  updateParticles(SIM_DT);
  saveToSnapshot(asset.particles);
  asset.nodeState = saveNodeStateWithShape();
  renderAssetParticles(ectx, ew, eh);
}

// Run N sim steps (at 60fps) then return — used to advance simulation to next capture point
function advanceAllAssets(ectx, ew, eh, bgHex, stretchPct, steps) {
  saveCurrentAssetLiveState();
  for (let s = 0; s < steps; s++) {
    simStepAllAssets(ectx, ew, eh, bgHex, stretchPct);
  }
  // Restore selected asset into globals
  const selId = getSelectedAssetId();
  if (selId !== null) {
    const sel = getAssetById(selId);
    if (sel) {
      restoreNodeStateWithShape(sel.nodeState);
      loadFromSnapshot(sel.particles);
    }
  }
}

function advanceSelectedAsset(ectx, ew, eh, bgHex, stretchPct, steps) {
  const selId = getSelectedAssetId();
  if (selId === null) return;
  const asset = getAssetById(selId);
  if (!asset) return;

  for (let s = 0; s < steps; s++) {
    simStepSelectedAsset(ectx, ew, eh, bgHex, stretchPct, asset);
  }
}

// ── Export orchestration ─────────────────────────────────────────────────────

async function doExport(exportMode) {
  const format = document.getElementById('export-format').value;
  const resMult = +document.getElementById('export-resolution').value;
  const bgSelect = document.getElementById('export-bg').value;
  const bgColorVal = document.getElementById('export-bg-color').value;
  const frameCount = +document.getElementById('export-frames').value;
  const duration = +document.getElementById('export-duration').value;

  const bg = bgSelect === 'custom' ? bgColorVal : (bgSelect === 'black' ? getBgColor() : bgSelect);

  const progress = document.getElementById('export-progress');
  const progressFill = progress.querySelector('.progress-fill');
  const progressText = progress.querySelector('.progress-text');
  const goBtn = document.getElementById('export-go');

  progress.classList.remove('hidden');
  goBtn.disabled = true;

  const prefix = exportMode === 'shape' ? 'flow-shape' : 'flow-dither';

  try {
    if (format === 'png') {
      const canvas = document.createElement('canvas');
      if (exportMode === 'shape') {
        renderSelectedAssetStatic(canvas, resMult, bg);
      } else {
        renderAllAssetsStatic(canvas, resMult, bg);
      }
      progressFill.style.width = '100%';
      progressText.textContent = '100%';
      downloadCanvas(canvas, `${prefix}.png`);
    } else if (format === 'png-sequence') {
      const canvas = document.createElement('canvas');
      const ew = DW * resMult;
      const eh = DH * resMult;
      canvas.width = ew;
      canvas.height = eh;
      const ectx = canvas.getContext('2d');
      // Fill initial background
      const bgHex = bg === 'transparent' ? '#000000' : (bg || getBgColor());
      ectx.fillStyle = bgHex;
      ectx.fillRect(0, 0, ew, eh);

      const stretchPct = getState().stretchPct || 0.45;
      // Total sim frames at 60fps, capture evenly spaced
      const totalSimFrames = Math.round(duration * SIM_FPS);
      const advanceFn = exportMode === 'shape' ? advanceSelectedAsset : advanceAllAssets;

      // Warmup: 60 sim frames (~1 second) to build trails
      advanceFn(ectx, ew, eh, bgHex, stretchPct, 60);

      for (let i = 0; i < frameCount; i++) {
        const stepsThisFrame = Math.round(totalSimFrames / frameCount);
        advanceFn(ectx, ew, eh, bgHex, stretchPct, stepsThisFrame);
        const pct = Math.round(((i + 1) / frameCount) * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = pct + '%';
        downloadCanvas(canvas, `${prefix}-${String(i).padStart(4, '0')}.png`);
        await new Promise(r => setTimeout(r, 50));
      }
    } else if (format === 'gif') {
      await exportGIF(resMult, bg, frameCount, duration, exportMode, prefix, (pct) => {
        progressFill.style.width = pct + '%';
        progressText.textContent = pct + '%';
      });
    }
  } catch (err) {
    console.error('Export error:', err);
    alert('Export failed: ' + err.message);
  }

  goBtn.disabled = false;
  setTimeout(() => {
    progress.classList.add('hidden');
    progressFill.style.width = '0';
  }, 1500);
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

async function exportGIF(resMult, bg, frameCount, duration, exportMode, prefix, onProgress) {
  const GIF = window.GIF || (await loadGifJs());

  if (!GIF) {
    alert('GIF export requires gif.js. Install it or use PNG sequence instead.');
    return;
  }

  const ew = DW * resMult;
  const eh = DH * resMult;
  const canvas = document.createElement('canvas');
  canvas.width = ew;
  canvas.height = eh;
  const ectx = canvas.getContext('2d');

  // Fill initial background
  const bgHex = (bg === 'transparent') ? '#000000' : (bg || getBgColor());
  ectx.fillStyle = bgHex;
  ectx.fillRect(0, 0, ew, eh);

  const delay = (duration / frameCount) * 1000; // ms between GIF frames
  const stretchPct = getState().stretchPct || 0.45;

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: ew,
    height: eh,
    workerScript: '/gif.worker.js',
  });

  const advanceFn = exportMode === 'shape' ? advanceSelectedAsset : advanceAllAssets;

  // Total sim frames at 60fps for the whole duration
  const totalSimFrames = Math.round(duration * SIM_FPS);
  // Sim steps per captured frame
  const stepsPerFrame = Math.max(1, Math.round(totalSimFrames / frameCount));

  // Warmup: 60 sim frames (~1 second) to build trails
  advanceFn(ectx, ew, eh, bgHex, stretchPct, 60);

  for (let i = 0; i < frameCount; i++) {
    advanceFn(ectx, ew, eh, bgHex, stretchPct, stepsPerFrame);
    gif.addFrame(canvas, { copy: true, delay });
    onProgress(Math.round(((i + 1) / frameCount) * 80));
  }

  return new Promise((resolve, reject) => {
    gif.on('finished', blob => {
      onProgress(100);
      const a = document.createElement('a');
      a.download = `${prefix}.gif`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
      resolve();
    });
    gif.on('error', reject);
    gif.render();
  });
}

async function loadGifJs() {
  try {
    const mod = await import('gif.js');
    return mod.default || mod;
  } catch {
    return null;
  }
}
