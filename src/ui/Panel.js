import { nodeColor, hexAlpha } from '../utils/color.js';
import { normA, fmtAngle } from '../utils/math.js';
import {
  getState, setActiveId, setFlowDir,
  setFillDensity, setSpeedMult, setGrainSpace, setStretchPct, setParticleColor, setOpacity, setFlowCategory, setSpiralMode, setRadialMode,
  addNodeAtBestGap, deleteNode, getNodeById,
  linkAnchorToNode, setPlacingAnchor, deleteAnchor, getAnchorById,
  setActiveAnchorId,
} from '../nodes/NodeManager.js';
import { renderOverlay } from '../nodes/NodeOverlay.js';
import { reinit as reinitParticles } from '../core/ParticleSystem.js';
import {
  getSelectedAssetId, getAllAssets, getAssetById,
  removeAsset, selectAsset, deselectAll,
  getBgColor, setBgColor, pushGlobalUndo, reorderAsset,
} from '../core/ShapeManager.js';

// ── Shape creation callbacks ────────────────────────────────────────────────
let _onCreatePrimitive = null;
let _onActivatePenTool = null;
let _onAlignShape = null;

export function setOnCreatePrimitive(cb) { _onCreatePrimitive = cb; }
export function setOnActivatePenTool(cb) { _onActivatePenTool = cb; }
export function setOnAlignShape(cb) { _onAlignShape = cb; }

// ── Popover state ───────────────────────────────────────────────────────────
let openPopover = null;  // { type: 'node'|'anchor'|'shape', id: number }

export function closePopover() {
  const el = document.getElementById('prop-popover');
  if (el) el.remove();
  openPopover = null;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Popover viewport clamping ────────────────────────────────────────────────
function clampPopoverToViewport(pop) {
  const rect = pop.getBoundingClientRect();
  const overflow = rect.bottom - window.innerHeight + 8;
  if (overflow > 0) {
    const currentTop = parseFloat(pop.style.top) || 0;
    pop.style.top = Math.max(8, currentTop - overflow) + 'px';
  }
}

// ── Shared row builder ──────────────────────────────────────────────────────
const EDIT_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/>
  <path d="M18.4 2.6a2.17 2.17 0 0 1 3 3L12 15l-4 1 1-4 9.4-9.4z"/>
</svg>`;

// ── Shape Popover ────────────────────────────────────────────────────────────

function openShapePopover(asset, rowEl) {
  closePopover();
  openPopover = { type: 'shape', id: asset.id };

  const state = getState();
  const pop = document.createElement('div');
  pop.id = 'prop-popover';
  pop.className = 'prop-popover';

  const panelEl = document.getElementById('panel');
  const rowRect = rowEl.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  pop.style.top = Math.max(8, rowRect.top) + 'px';
  pop.style.right = (window.innerWidth - panelRect.left + 8) + 'px';

  const flowDir = state.flowDir;
  const fCat = state.flowCategory || 'spiral';
  const sMode = state.spiralMode || 'edge';
  const rMode = state.radialMode || 'edge';
  const fillPct = Math.round(state.fillDensity * 100);
  const speedVal = state.speedMult.toFixed(1);
  const grainVal = state.grainSpace;
  const trailPct = Math.round(state.stretchPct * 100);
  const opacityPct = Math.round((state.opacity != null ? state.opacity : 1) * 100);
  const pColor = state.particleColor || '#ffffff';

  pop.innerHTML = `
    <div class="pop-header">
      <div class="ndot" style="background:#aaa;box-shadow:0 0 6px #aaa55"></div>
      <input type="text" class="pop-name-input" value="${escapeHtml(asset.name)}" data-id="${asset.id}" data-type="shape" spellcheck="false">
      <button class="pop-close">&times;</button>
    </div>
    <div class="pop-body">
      <div class="pop-group-label">Direction</div>
      <div style="display:flex;gap:6px;margin-bottom:4px">
        <button class="dir-btn${flowDir === 1 ? ' active' : ''}" data-dir="1">CCW</button>
        <button class="dir-btn${flowDir === -1 ? ' active' : ''}" data-dir="-1">CW</button>
      </div>

      <div class="pop-group-label">Flow Type</div>
      <div class="flow-cat-row" style="margin-bottom:8px">
        <label class="flow-cat-label${fCat === 'spiral' ? ' active' : ''}">
          <input type="radio" name="flow-cat" value="spiral" ${fCat === 'spiral' ? 'checked' : ''}> Spiral
        </label>
        <div class="flow-sub${fCat === 'spiral' ? '' : ' disabled'}" id="spiral-sub">
          <button class="grav-btn spiral-btn${fCat === 'spiral' && sMode === 'edge' ? ' active' : ''}" data-spiral="edge" ${fCat !== 'spiral' ? 'disabled' : ''}>Edge</button>
          <button class="grav-btn spiral-btn${fCat === 'spiral' && sMode === 'center' ? ' active' : ''}" data-spiral="center" ${fCat !== 'spiral' ? 'disabled' : ''}>Center</button>
        </div>
      </div>
      <div class="flow-cat-row" style="margin-bottom:4px">
        <label class="flow-cat-label${fCat === 'radial' ? ' active' : ''}">
          <input type="radio" name="flow-cat" value="radial" ${fCat === 'radial' ? 'checked' : ''}> Radial
        </label>
        <div class="flow-sub${fCat === 'radial' ? '' : ' disabled'}" id="radial-sub">
          <button class="grav-btn radial-btn${fCat === 'radial' && rMode === 'edge' ? ' active' : ''}" data-radial="edge" ${fCat !== 'radial' ? 'disabled' : ''}>Edge</button>
          <button class="grav-btn radial-btn${fCat === 'radial' && rMode === 'center' ? ' active' : ''}" data-radial="center" ${fCat !== 'radial' ? 'disabled' : ''}>Center</button>
        </div>
      </div>

      <div class="pop-group-label">Flow</div>
      <div class="sr">
        <div class="sl"><span>Fill</span><span class="sv" id="pop-fill-val">${fillPct}%</span></div>
        <input type="range" id="pop-fill-sl" min="5" max="100" value="${fillPct}">
      </div>
      <div class="sr">
        <div class="sl"><span>Speed</span><span class="sv" id="pop-speed-val">${speedVal}\u00D7</span></div>
        <input type="range" id="pop-speed-sl" min="5" max="400" value="${Math.round(state.speedMult * 100)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Grain</span><span class="sv" id="pop-grain-val">${grainVal}</span></div>
        <input type="range" id="pop-grain-sl" min="3" max="28" value="${grainVal}" step="0.5">
      </div>
      <div class="sr">
        <div class="sl"><span>Trail</span><span class="sv" id="pop-trail-val">${trailPct}%</span></div>
        <input type="range" id="pop-trail-sl" min="10" max="85" value="${trailPct}" step="1">
      </div>
      <div class="sr">
        <div class="sl"><span>Opacity</span><span class="sv" id="pop-opacity-val">${opacityPct}%</span></div>
        <input type="range" id="pop-opacity-sl" min="1" max="100" value="${opacityPct}" step="1">
      </div>

      <div class="pop-group-label">Colour</div>
      <div class="gr" style="margin-bottom:0">
        <input type="color" id="pop-color-picker" value="${pColor}" style="width:28px;height:22px;border:1px solid #333;border-radius:3px;background:none;cursor:pointer;padding:0;flex-shrink:0">
        <input type="text" class="hex-input" id="pop-color-hex" value="${pColor}" maxlength="7" spellcheck="false">
      </div>
    </div>
  `;

  document.body.appendChild(pop);
  clampPopoverToViewport(pop);
  bindShapePopoverEvents(pop, asset);
}

function bindShapePopoverEvents(pop, asset) {
  // Push undo before any slider drag
  pop.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'range') {
      pushGlobalUndo();
    }
  });

  pop.querySelector('.pop-close').addEventListener('click', () => {
    closePopover();
    buildPanel();
  });

  // Rename
  pop.querySelector('.pop-name-input').addEventListener('focus', () => pushGlobalUndo());
  pop.querySelector('.pop-name-input').addEventListener('input', e => {
    const a = getAssetById(asset.id);
    if (a) {
      a.name = e.target.value || 'Shape';
      const row = document.querySelector(`.item-row[data-shape-id="${a.id}"] .item-label`);
      if (row) row.textContent = a.name;
    }
  });

  // Direction buttons
  pop.querySelectorAll('.dir-btn').forEach(b => {
    b.addEventListener('click', () => {
      pushGlobalUndo();
      setFlowDir(+b.dataset.dir);
      pop.querySelectorAll('.dir-btn').forEach(x => x.classList.toggle('active', x === b));
      buildPanel();
      renderOverlay();
    });
  });

  // Flow category radio buttons
  pop.querySelectorAll('input[name="flow-cat"]').forEach(radio => {
    radio.addEventListener('change', () => {
      pushGlobalUndo();
      const cat = radio.value;
      setFlowCategory(cat);
      // Update label highlights
      pop.querySelectorAll('.flow-cat-label').forEach(l => l.classList.toggle('active', l.querySelector('input').value === cat));
      // Enable/disable sub-buttons
      const spiralSub = pop.querySelector('#spiral-sub');
      const radialSub = pop.querySelector('#radial-sub');
      spiralSub.classList.toggle('disabled', cat !== 'spiral');
      radialSub.classList.toggle('disabled', cat !== 'radial');
      spiralSub.querySelectorAll('.spiral-btn').forEach(b => b.disabled = cat !== 'spiral');
      radialSub.querySelectorAll('.radial-btn').forEach(b => b.disabled = cat !== 'radial');
      // Activate the current sub-mode button for the selected category
      if (cat === 'spiral') {
        const sm = getState().spiralMode || 'edge';
        spiralSub.querySelectorAll('.spiral-btn').forEach(b => b.classList.toggle('active', b.dataset.spiral === sm));
      } else {
        const rm = getState().radialMode || 'edge';
        radialSub.querySelectorAll('.radial-btn').forEach(b => b.classList.toggle('active', b.dataset.radial === rm));
      }
      reinitParticles();
    });
  });

  // Spiral mode buttons
  pop.querySelectorAll('.spiral-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      pushGlobalUndo();
      setSpiralMode(b.dataset.spiral);
      pop.querySelectorAll('.spiral-btn').forEach(x => x.classList.toggle('active', x === b));
      reinitParticles();
    });
  });

  // Radial mode buttons
  pop.querySelectorAll('.radial-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      pushGlobalUndo();
      setRadialMode(b.dataset.radial);
      pop.querySelectorAll('.radial-btn').forEach(x => x.classList.toggle('active', x === b));
      reinitParticles();
    });
  });

  // Fill
  const fillSl = pop.querySelector('#pop-fill-sl');
  fillSl.addEventListener('input', () => {
    setFillDensity(+fillSl.value / 100);
    pop.querySelector('#pop-fill-val').textContent = fillSl.value + '%';
    reinitParticles();
  });

  // Speed
  const speedSl = pop.querySelector('#pop-speed-sl');
  speedSl.addEventListener('input', () => {
    const v = +speedSl.value / 100;
    setSpeedMult(v);
    pop.querySelector('#pop-speed-val').textContent = v.toFixed(1) + '\u00D7';
  });

  // Grain
  const grainSl = pop.querySelector('#pop-grain-sl');
  grainSl.addEventListener('input', () => {
    setGrainSpace(+grainSl.value);
    pop.querySelector('#pop-grain-val').textContent = grainSl.value;
  });

  // Trail
  const trailSl = pop.querySelector('#pop-trail-sl');
  trailSl.addEventListener('input', () => {
    setStretchPct(+trailSl.value / 100);
    pop.querySelector('#pop-trail-val').textContent = trailSl.value + '%';
  });

  // Opacity
  const opacitySl = pop.querySelector('#pop-opacity-sl');
  opacitySl.addEventListener('input', () => {
    setOpacity(+opacitySl.value / 100);
    pop.querySelector('#pop-opacity-val').textContent = opacitySl.value + '%';
  });

  // Particle color
  const colorPicker = pop.querySelector('#pop-color-picker');
  const colorHex = pop.querySelector('#pop-color-hex');
  colorPicker.addEventListener('pointerdown', () => pushGlobalUndo());
  colorPicker.addEventListener('input', () => {
    setParticleColor(colorPicker.value);
    colorHex.value = colorPicker.value;
  });
  colorHex.addEventListener('focus', () => pushGlobalUndo());
  colorHex.addEventListener('input', () => {
    const v = colorHex.value;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      setParticleColor(v);
      colorPicker.value = v;
    }
  });
}

// ── Node Popover ─────────────────────────────────────────────────────────────

function openNodePopover(n, idx, rowEl) {
  closePopover();
  openPopover = { type: 'node', id: n.id };

  const state = getState();
  const { flowDir, anchors, placingAnchorForNode } = state;
  const col = nodeColor(idx);
  const tanDirAng = Math.atan2(Math.cos(n.angle) * flowDir, -Math.sin(n.angle) * flowDir);
  const relAng = Math.round(normA(n.handleAngle - tanDirAng) * 180 / Math.PI);
  const relStr = relAng === 0 ? 'tangent' : (relAng > 0 ? `+${relAng}\u00B0` : `${relAng}\u00B0`);

  const pop = document.createElement('div');
  pop.id = 'prop-popover';
  pop.className = 'prop-popover';

  const panelEl = document.getElementById('panel');
  const rowRect = rowEl.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  pop.style.top = Math.max(8, rowRect.top) + 'px';
  pop.style.right = (window.innerWidth - panelRect.left + 8) + 'px';

  pop.innerHTML = `
    <div class="pop-header">
      <div class="ndot" style="background:${col};box-shadow:0 0 6px ${col}55"></div>
      <input type="text" class="pop-name-input" value="${escapeHtml(n.name)}" data-id="${n.id}" data-type="node" spellcheck="false">
      <button class="pop-close">&times;</button>
    </div>
    <div class="pop-body">
      <div class="pop-group-label">Position</div>
      <div class="sr">
        <div class="sl"><span>Direction</span><span class="sv" id="rv-${n.id}">${relStr}</span></div>
        <input type="range" class="rsl" data-id="${n.id}" min="-180" max="180"
          value="${Math.round(normA(n.handleAngle - tanDirAng) * 180 / Math.PI)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Spread</span><span class="sv" id="spv-${n.id}">${Math.round(n.spread * 180 / Math.PI)}\u00B0</span></div>
        <input type="range" class="spsl" data-id="${n.id}" min="15" max="180" value="${Math.round(n.spread * 180 / Math.PI)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Bleed</span><span class="sv" id="bv-${n.id}">${Math.round(n.bleed * 100)}%</span></div>
        <input type="range" class="bsl" data-id="${n.id}" min="0" max="100" value="${Math.round(n.bleed * 100)}">
      </div>

      <div class="pop-group-label">Flow Stream</div>
      <div class="sr">
        <div class="sl"><span>Steer</span><span class="sv" id="dsv-${n.id}">${Math.round(n.directionStrength * 100)}%</span></div>
        <input type="range" class="dssl" data-id="${n.id}" min="0" max="100" value="${Math.round(n.directionStrength * 100)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Pull</span><span class="sv" id="pv-${n.id}">${Math.round(n.pull * 100)}%</span></div>
        <input type="range" class="psl" data-id="${n.id}" min="0" max="100" value="${Math.round(n.pull * 100)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Stretch</span><span class="sv" id="stv-${n.id}">${Math.round(n.stretch * 100)}%</span></div>
        <input type="range" class="stsl" data-id="${n.id}" min="0" max="100" value="${Math.round(n.stretch * 100)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Length</span><span class="sv" id="slv-${n.id}">${Math.round(n.streamLength * 100)}%</span></div>
        <input type="range" class="slsl" data-id="${n.id}" min="0" max="100" value="${Math.round(n.streamLength * 100)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Fade</span><span class="sv" id="fv-${n.id}">${Math.round(n.fade * 100)}%</span></div>
        <input type="range" class="fsl" data-id="${n.id}" min="0" max="100" value="${Math.round(n.fade * 100)}">
      </div>

      ${anchors.length > 0 ? `<div class="pop-group-label">Anchors</div>
      ${anchors.map(a => `<label class="al"><input type="checkbox" class="acb" data-node="${n.id}" data-anchor="${a.id}" ${n.linkedAnchors.indexOf(a.id) >= 0 ? 'checked' : ''}> ${escapeHtml(a.name)}</label>`).join('')}` : ''}
    </div>
  `;

  document.body.appendChild(pop);
  clampPopoverToViewport(pop);
  bindPopoverNodeEvents(pop, n, flowDir);
}

function bindPopoverNodeEvents(pop, n, flowDir) {
  // Push undo before any slider drag or checkbox toggle
  pop.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'INPUT' && (e.target.type === 'range' || e.target.type === 'checkbox')) {
      pushGlobalUndo();
    }
  });

  pop.querySelector('.pop-close').addEventListener('click', () => {
    closePopover();
    buildPanel();
  });

  // Rename
  pop.querySelector('.pop-name-input').addEventListener('focus', () => pushGlobalUndo());
  pop.querySelector('.pop-name-input').addEventListener('input', e => {
    const nd = getNodeById(+e.target.dataset.id);
    if (nd) {
      nd.name = e.target.value || `Node ${nd.id}`;
      const row = document.querySelector(`.item-row[data-id="${nd.id}"] .item-label`);
      if (row) row.textContent = nd.name;
      renderOverlay();
    }
  });

  // Direction
  pop.querySelectorAll('.rsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      const tanDirAng = Math.atan2(Math.cos(nd.angle) * flowDir, -Math.sin(nd.angle) * flowDir);
      nd.handleAngle = tanDirAng + +e.target.value * Math.PI / 180;
      const relAng = +e.target.value;
      const el = document.getElementById(`rv-${nd.id}`);
      if (el) el.textContent = relAng === 0 ? 'tangent' : (relAng > 0 ? `+${relAng}\u00B0` : `${relAng}\u00B0`);
      renderOverlay();
    });
  });

  // Bleed
  pop.querySelectorAll('.bsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      nd.bleed = +e.target.value / 100;
      const el = document.getElementById(`bv-${nd.id}`);
      if (el) el.textContent = e.target.value + '%';
      renderOverlay();
    });
  });

  // Spread
  pop.querySelectorAll('.spsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      nd.spread = +e.target.value * Math.PI / 180;
      const el = document.getElementById(`spv-${nd.id}`);
      if (el) el.textContent = e.target.value + '\u00B0';
      renderOverlay();
    });
  });

  // Steer
  pop.querySelectorAll('.dssl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      nd.directionStrength = +e.target.value / 100;
      const el = document.getElementById(`dsv-${nd.id}`);
      if (el) el.textContent = e.target.value + '%';
    });
  });

  // Pull
  pop.querySelectorAll('.psl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      nd.pull = +e.target.value / 100;
      const el = document.getElementById(`pv-${nd.id}`);
      if (el) el.textContent = e.target.value + '%';
    });
  });

  // Fade
  pop.querySelectorAll('.fsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      nd.fade = +e.target.value / 100;
      const el = document.getElementById(`fv-${nd.id}`);
      if (el) el.textContent = e.target.value + '%';
    });
  });

  // Stretch
  pop.querySelectorAll('.stsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      nd.stretch = +e.target.value / 100;
      const el = document.getElementById(`stv-${nd.id}`);
      if (el) el.textContent = e.target.value + '%';
    });
  });

  // Length
  pop.querySelectorAll('.slsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const nd = getNodeById(+e.target.dataset.id);
      if (!nd) return;
      nd.streamLength = +e.target.value / 100;
      const el = document.getElementById(`slv-${nd.id}`);
      if (el) el.textContent = e.target.value + '%';
    });
  });

  // Anchor checkboxes
  pop.querySelectorAll('.acb').forEach(cb => {
    cb.addEventListener('change', e => {
      linkAnchorToNode(+e.target.dataset.node, +e.target.dataset.anchor);
      renderOverlay();
    });
  });

}

// ── Anchor Popover ───────────────────────────────────────────────────────────

function openAnchorPopover(a, rowEl) {
  closePopover();
  openPopover = { type: 'anchor', id: a.id };

  const pop = document.createElement('div');
  pop.id = 'prop-popover';
  pop.className = 'prop-popover';

  const panelEl = document.getElementById('panel');
  const rowRect = rowEl.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  pop.style.top = Math.max(8, rowRect.top) + 'px';
  pop.style.right = (window.innerWidth - panelRect.left + 8) + 'px';

  pop.innerHTML = `
    <div class="pop-header">
      <div class="ndot" style="background:#ffaa00;box-shadow:0 0 6px #ffaa0055"></div>
      <input type="text" class="pop-name-input" value="${escapeHtml(a.name)}" data-aid="${a.id}" data-type="anchor" spellcheck="false">
      <button class="pop-close">&times;</button>
    </div>
    <div class="pop-body">
      <div class="sr">
        <div class="sl"><span>Radius</span><span class="sv" id="arv-${a.id}">${a.radius}</span></div>
        <input type="range" class="arsl" data-aid="${a.id}" min="10" max="500" value="${a.radius}">
      </div>
      <div class="sr">
        <div class="sl"><span>Strength</span><span class="sv" id="asv-${a.id}">${Math.round(a.strength * 100)}%</span></div>
        <input type="range" class="assl" data-aid="${a.id}" min="0" max="100" value="${Math.round(a.strength * 100)}">
      </div>
      <div class="sr">
        <div class="sl"><span>Fade</span><span class="sv" id="afv-${a.id}">${Math.round(a.fade * 100)}%</span></div>
        <input type="range" class="afsl" data-aid="${a.id}" min="0" max="100" value="${Math.round(a.fade * 100)}">
      </div>
    </div>
  `;

  document.body.appendChild(pop);
  clampPopoverToViewport(pop);

  // Push undo before any slider drag
  pop.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'range') {
      pushGlobalUndo();
    }
  });

  pop.querySelector('.pop-close').addEventListener('click', () => {
    closePopover();
    buildPanel();
  });

  // Rename
  pop.querySelector('.pop-name-input').addEventListener('focus', () => pushGlobalUndo());
  pop.querySelector('.pop-name-input').addEventListener('input', e => {
    const anc = getAnchorById(+e.target.dataset.aid);
    if (anc) {
      anc.name = e.target.value || `Anchor ${anc.id}`;
      const row = document.querySelector(`.item-row[data-aid="${anc.id}"] .item-label`);
      if (row) row.textContent = anc.name;
      renderOverlay();
    }
  });

  pop.querySelectorAll('.arsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const anc = getAnchorById(+e.target.dataset.aid);
      if (!anc) return;
      anc.radius = +e.target.value;
      const el = document.getElementById(`arv-${anc.id}`);
      if (el) el.textContent = e.target.value;
      renderOverlay();
    });
  });

  pop.querySelectorAll('.assl').forEach(sl => {
    sl.addEventListener('input', e => {
      const anc = getAnchorById(+e.target.dataset.aid);
      if (!anc) return;
      anc.strength = +e.target.value / 100;
      const el = document.getElementById(`asv-${anc.id}`);
      if (el) el.textContent = e.target.value + '%';
    });
  });

  pop.querySelectorAll('.afsl').forEach(sl => {
    sl.addEventListener('input', e => {
      const anc = getAnchorById(+e.target.dataset.aid);
      if (!anc) return;
      anc.fade = +e.target.value / 100;
      const el = document.getElementById(`afv-${anc.id}`);
      if (el) el.textContent = e.target.value + '%';
    });
  });
}

// ── Build Shape Rows ─────────────────────────────────────────────────────────

function buildShapeRows() {
  const shapesList = document.getElementById('shapes-list');
  if (!shapesList) return;
  shapesList.innerHTML = '';

  const assets = getAllAssets();
  const selId = getSelectedAssetId();

  let draggedAssetId = null;

  for (const asset of assets) {
    const isSelected = asset.id === selId;
    const row = document.createElement('div');
    row.className = 'item-row' + (isSelected ? ' active' : '');
    row.dataset.shapeId = asset.id;
    row.draggable = true;

    const isOpen = openPopover?.type === 'shape' && openPopover.id === asset.id;

    const isVisible = asset.visible !== false;
    row.innerHTML = `
      <div class="ndot" style="background:#aaa;box-shadow:0 0 6px #aaa55"></div>
      <span class="item-label">${escapeHtml(asset.name)}</span>
      <button class="item-vis${isVisible ? '' : ' off'}" data-shape-id="${asset.id}" title="${isVisible ? 'Hide' : 'Show'} layer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${isVisible
            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
            : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'}
        </svg>
      </button>
      <button class="item-edit${isOpen ? ' open' : ''}" data-shape-id="${asset.id}" title="Edit properties">${EDIT_ICON}</button>
      <button class="ndel" data-shape-id="${asset.id}">&times;</button>
    `;

    // ── Drag-to-reorder handlers ──
    row.addEventListener('dragstart', (e) => {
      draggedAssetId = asset.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedAssetId === null || draggedAssetId === asset.id) return;
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const above = e.clientY < midY;
      row.classList.toggle('drag-over-above', above);
      row.classList.toggle('drag-over-below', !above);
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-above', 'drag-over-below');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over-above', 'drag-over-below');
      if (draggedAssetId === null || draggedAssetId === asset.id) return;
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      // Compute target index in the assets array
      const allAssets = getAllAssets();
      let targetIdx = allAssets.findIndex(a => a.id === asset.id);
      if (!above) targetIdx++;
      // Adjust if dragged item was before the target
      const fromIdx = allAssets.findIndex(a => a.id === draggedAssetId);
      if (fromIdx < targetIdx) targetIdx--;
      pushGlobalUndo();
      reorderAsset(draggedAssetId, targetIdx);
      draggedAssetId = null;
      buildPanel();
      renderOverlay();
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedAssetId = null;
      shapesList.querySelectorAll('.item-row').forEach(r => {
        r.classList.remove('drag-over-above', 'drag-over-below');
      });
    });

    row.addEventListener('mousedown', (e) => {
      if (e.target.closest('.item-edit') || e.target.closest('.ndel') || e.target.closest('.item-vis')) return;
      if (asset.visible === false) return;
      if (!isSelected) {
        selectAsset(asset.id);
        if (window._syncAfterShapeSelect) window._syncAfterShapeSelect();
        buildPanel();
        renderOverlay();
      }
    });

    row.querySelector('.item-vis').addEventListener('click', (e) => {
      e.stopPropagation();
      pushGlobalUndo();
      asset.visible = !asset.visible;
      // If hiding the currently selected shape, deselect it
      if (!asset.visible && getSelectedAssetId() === asset.id) {
        deselectAll();
      }
      buildPanel();
      renderOverlay();
    });

    row.querySelector('.item-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      if (asset.visible === false) return;
      if (!isSelected) {
        selectAsset(asset.id);
        if (window._syncAfterShapeSelect) window._syncAfterShapeSelect();
      }
      if (isOpen) {
        closePopover();
      } else {
        openShapePopover(asset, row);
      }
      buildPanel();
      renderOverlay();
    });

    row.querySelector('.ndel').addEventListener('click', (e) => {
      e.stopPropagation();
      pushGlobalUndo();
      if (openPopover?.type === 'shape' && openPopover.id === asset.id) closePopover();
      removeAsset(asset.id);
      buildPanel();
      renderOverlay();
    });

    shapesList.appendChild(row);
  }
}

// ── Build Panel ─────────────────────────────────────────────────────────────

export function buildPanel() {
  const state = getState();
  const { nodes, activeId, flowDir, anchors, placingAnchorForNode, activeAnchorId } = state;

  // Build shape rows
  buildShapeRows();

  // Toggle shape-section visibility based on selection
  const hasSelection = getSelectedAssetId() !== null;
  document.querySelectorAll('.shape-section').forEach(el => {
    el.style.display = hasSelection ? '' : 'none';
  });

  // Toggle shape-selected-controls and position section
  const shapeControls = document.querySelector('.shape-selected-controls');
  if (shapeControls) {
    shapeControls.style.display = hasSelection ? '' : 'none';
  }

  const hasAnchorSelection = activeAnchorId !== null;
  const positionEnabled = hasSelection || hasAnchorSelection;
  const alignContainer = document.getElementById('align-row-container');
  if (alignContainer) {
    alignContainer.classList.toggle('disabled-section', !positionEnabled);
  }

  // Update export dropdown disabled state
  const exportShapeItem = document.querySelector('.export-dropdown-item[data-mode="shape"]');
  if (exportShapeItem) {
    exportShapeItem.classList.toggle('disabled', !hasSelection);
  }

  // ── Node rows ─────────────────────────────────────────────────────────────
  const nodesList = document.getElementById('nodes-list');
  nodesList.innerHTML = '';

  nodes.forEach((n, i) => {
    const col = nodeColor(i);
    const row = document.createElement('div');
    row.className = 'item-row' + (n.id === activeId ? ' active' : '');
    row.dataset.id = n.id;
    if (n.id === activeId) row.style.borderColor = col;

    const isOpen = openPopover?.type === 'node' && openPopover.id === n.id;

    row.innerHTML = `
      <div class="ndot" style="background:${col};box-shadow:0 0 6px ${col}55"></div>
      <span class="item-label">${escapeHtml(n.name)}</span>
      <button class="item-edit${isOpen ? ' open' : ''}" data-id="${n.id}" data-idx="${i}" title="Edit properties">${EDIT_ICON}</button>
      <button class="ndel" data-id="${n.id}">&times;</button>
    `;

    row.addEventListener('mousedown', (e) => {
      if (e.target.closest('.item-edit') || e.target.closest('.ndel')) return;
      if (n.id !== activeId) {
        setActiveId(n.id);
        setActiveAnchorId(null);
        buildPanel();
        renderOverlay();
      }
    });

    row.querySelector('.item-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      setActiveId(n.id);
      setActiveAnchorId(null);
      if (isOpen) {
        closePopover();
      } else {
        openNodePopover(n, i, row);
      }
      buildPanel();
      renderOverlay();
    });

    row.querySelector('.ndel').addEventListener('click', (e) => {
      e.stopPropagation();
      pushGlobalUndo();
      if (openPopover?.type === 'node' && openPopover.id === n.id) closePopover();
      deleteNode(n.id);
      buildPanel();
      renderOverlay();
    });

    nodesList.appendChild(row);
  });

  // ── Anchor rows ───────────────────────────────────────────────────────────
  const anchorsList = document.getElementById('anchors-list');
  anchorsList.innerHTML = '';

  for (const a of anchors) {
    const isActive = a.id === activeAnchorId;
    const row = document.createElement('div');
    row.className = 'item-row anchor-row' + (isActive ? ' active' : '');
    row.dataset.aid = a.id;

    const isOpen = openPopover?.type === 'anchor' && openPopover.id === a.id;

    row.innerHTML = `
      <div class="ndot" style="background:#ffaa00;box-shadow:0 0 6px #ffaa0055"></div>
      <span class="item-label">${escapeHtml(a.name)}</span>
      <button class="item-edit${isOpen ? ' open' : ''}" data-aid="${a.id}" title="Edit properties">${EDIT_ICON}</button>
      <button class="ndel anchor-del" data-aid="${a.id}">&times;</button>
    `;

    row.addEventListener('mousedown', (e) => {
      if (e.target.closest('.item-edit') || e.target.closest('.ndel')) return;
      setActiveAnchorId(a.id);
      setActiveId(null);
      buildPanel();
      renderOverlay();
    });

    row.querySelector('.item-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      setActiveAnchorId(a.id);
      setActiveId(null);
      if (isOpen) {
        closePopover();
      } else {
        openAnchorPopover(a, row);
      }
      buildPanel();
      renderOverlay();
    });

    row.querySelector('.ndel').addEventListener('click', (e) => {
      e.stopPropagation();
      pushGlobalUndo();
      if (openPopover?.type === 'anchor' && openPopover.id === a.id) closePopover();
      deleteAnchor(a.id);
      buildPanel();
      renderOverlay();
    });

    anchorsList.appendChild(row);
  }

  // Placing indicator
  if (placingAnchorForNode !== null) {
    const hint = document.createElement('div');
    hint.className = 'placing-hint';
    hint.textContent = 'Click canvas to place anchor\u2026';
    anchorsList.appendChild(hint);
  }
}

export function initGlobalControls() {
  // ── Global alignment buttons ──────────────────────────────────────────
  document.querySelectorAll('#global-align-row .align-btn').forEach(b => {
    b.addEventListener('click', () => {
      const st = getState();
      pushGlobalUndo();
      if (st.activeAnchorId !== null) {
        if (_onAlignShape) _onAlignShape(st.activeAnchorId, b.dataset.align, 'anchor');
      } else {
        const selId = getSelectedAssetId();
        if (!selId) return;
        if (_onAlignShape) _onAlignShape(selId, b.dataset.align, 'shape');
      }
    });
  });

  // [SHAPE-TOOLS] Add shape button → show creation popover
  const addShapeBtn = document.getElementById('add-shape-btn');
  if (addShapeBtn) {
    addShapeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Toggle popover
      const existing = document.querySelector('.shape-create-popover');
      if (existing) { existing.remove(); return; }

      const pop = document.createElement('div');
      pop.className = 'shape-create-popover';

      // Position below the button
      const btnRect = addShapeBtn.getBoundingClientRect();
      pop.style.top = (btnRect.bottom + 4) + 'px';
      pop.style.right = (window.innerWidth - btnRect.right) + 'px';

      pop.innerHTML = `
        <div class="shape-create-row" data-action="circle"><span>&#9675;</span> Circle</div>
        <div class="shape-create-row" data-action="rect"><span>&#9645;</span> Rectangle</div>
        <div class="shape-create-row" data-action="polygon"><span>&#11047;</span> Polygon <input type="number" class="poly-sides" min="3" max="12" value="6"></div>
        <div class="shape-create-row" data-action="pen"><span>&#10022;</span> Pen Tool</div>
        <div class="shape-create-row" data-action="svg"><span>&uarr;</span> Upload SVG</div>
      `;

      document.body.appendChild(pop);

      // Prevent clicks on number input from closing
      const sidesInput = pop.querySelector('.poly-sides');
      sidesInput.addEventListener('click', ev => ev.stopPropagation());
      sidesInput.addEventListener('mousedown', ev => ev.stopPropagation());

      function closeCreatePopover() { pop.remove(); document.removeEventListener('mousedown', outsideClick); }

      function outsideClick(ev) {
        if (!pop.contains(ev.target) && ev.target !== addShapeBtn) closeCreatePopover();
      }
      // Defer so the current click doesn't immediately close
      setTimeout(() => document.addEventListener('mousedown', outsideClick), 0);

      pop.querySelectorAll('.shape-create-row').forEach(row => {
        row.addEventListener('click', (ev) => {
          if (ev.target.classList.contains('poly-sides')) return; // don't trigger on number input click
          const action = row.dataset.action;
          const sides = parseInt(sidesInput.value) || 6;
          closeCreatePopover();
          if (action === 'circle' || action === 'rect' || action === 'polygon') {
            if (_onCreatePrimitive) _onCreatePrimitive(action, sides);
          } else if (action === 'pen') {
            if (_onActivatePenTool) _onActivatePenTool();
          } else if (action === 'svg') {
            document.getElementById('file-input').click();
          }
        });
      });
    });
  }

  // Add node button
  document.getElementById('add-btn').addEventListener('click', () => {
    pushGlobalUndo();
    addNodeAtBestGap();
    buildPanel();
    renderOverlay();
  });

  // Add anchor button (top-level, no auto-link)
  document.getElementById('add-anchor-btn').addEventListener('click', () => {
    pushGlobalUndo();
    setPlacingAnchor(-1);  // -1 = place without linking
    buildPanel();
  });

  // ── Background color controls ──────────────────────────────────────────
  const bgPicker = document.getElementById('bg-color-picker');
  const bgHex = document.getElementById('bg-color-hex');

  if (bgPicker) {
    bgPicker.addEventListener('pointerdown', () => pushGlobalUndo());
    bgPicker.addEventListener('input', () => {
      setBgColor(bgPicker.value);
      if (bgHex) bgHex.value = bgPicker.value;
    });
  }
  if (bgHex) {
    bgHex.addEventListener('focus', () => pushGlobalUndo());
    bgHex.addEventListener('change', () => {
      let val = bgHex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        setBgColor(val);
        if (bgPicker) bgPicker.value = val;
      } else {
        bgHex.value = getBgColor();
      }
    });
  }

  // ── Export dropdown ────────────────────────────────────────────────────
  const exportBtn = document.getElementById('export-btn');
  const exportDropdown = document.getElementById('export-dropdown');

  if (exportBtn && exportDropdown) {
    exportBtn.addEventListener('click', () => {
      const isVisible = exportDropdown.style.display !== 'none';
      exportDropdown.style.display = isVisible ? 'none' : '';
    });

    // Close dropdown when clicking outside
    document.addEventListener('mousedown', (e) => {
      if (exportDropdown.style.display !== 'none' &&
          !exportBtn.contains(e.target) &&
          !exportDropdown.contains(e.target)) {
        exportDropdown.style.display = 'none';
      }
    });

    exportDropdown.querySelectorAll('.export-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const mode = item.dataset.mode;
        exportDropdown.style.display = 'none';
        if (window._openExportModal) window._openExportModal(mode);
      });
    });
  }

  // Close popover when clicking outside
  document.addEventListener('mousedown', (e) => {
    if (!openPopover) return;
    const pop = document.getElementById('prop-popover');
    const panel = document.getElementById('panel');
    if (pop && !pop.contains(e.target) && !panel.contains(e.target)) {
      closePopover();
      buildPanel();
    }
  });
}
