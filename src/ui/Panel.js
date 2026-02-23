import { nodeColor, hexAlpha } from '../utils/color.js';
import { normA, fmtAngle } from '../utils/math.js';
import {
  getState, setActiveId, setFlowDir,
  setFillDensity, setSpeedMult, setGrainSpace, setStretchPct,
  addNodeAtBestGap, deleteNode, getNodeById,
  linkAnchorToNode, setPlacingAnchor, deleteAnchor, getAnchorById,
  setActiveAnchorId,
} from '../nodes/NodeManager.js';
import { renderOverlay } from '../nodes/NodeOverlay.js';
import { reinit as reinitParticles } from '../core/ParticleSystem.js';

// ── Popover state ───────────────────────────────────────────────────────────
let openPopover = null;  // { type: 'node'|'anchor', id: number }

function closePopover() {
  const el = document.getElementById('prop-popover');
  if (el) el.remove();
  openPopover = null;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

      <div class="pop-group-label">Anchors</div>
      ${anchors.map(a => `<label class="al"><input type="checkbox" class="acb" data-node="${n.id}" data-anchor="${a.id}" ${n.linkedAnchors.indexOf(a.id) >= 0 ? 'checked' : ''}> ${escapeHtml(a.name)}</label>`).join('')}
      <button class="anchor-add" data-node="${n.id}">${placingAnchorForNode === n.id ? 'Click canvas\u2026' : '+ Add Anchor'}</button>
    </div>
  `;

  document.body.appendChild(pop);
  bindPopoverNodeEvents(pop, n, flowDir);
}

function bindPopoverNodeEvents(pop, n, flowDir) {
  pop.querySelector('.pop-close').addEventListener('click', () => {
    closePopover();
    buildPanel();
  });

  // Rename
  pop.querySelector('.pop-name-input').addEventListener('input', e => {
    const nd = getNodeById(+e.target.dataset.id);
    if (nd) {
      nd.name = e.target.value || `Node ${nd.id}`;
      // Update the row label in the panel
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

  // Add Anchor (linked to this node)
  pop.querySelectorAll('.anchor-add').forEach(btn => {
    btn.addEventListener('click', () => {
      setPlacingAnchor(+btn.dataset.node);
      closePopover();
      buildPanel();
    });
  });
}

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

  pop.querySelector('.pop-close').addEventListener('click', () => {
    closePopover();
    buildPanel();
  });

  // Rename
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

// ── Shared row builder ──────────────────────────────────────────────────────
const EDIT_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/>
  <path d="M18.4 2.6a2.17 2.17 0 0 1 3 3L12 15l-4 1 1-4 9.4-9.4z"/>
</svg>`;

// ── Build Panel ─────────────────────────────────────────────────────────────
export function buildPanel() {
  const state = getState();
  const { nodes, activeId, flowDir, anchors, placingAnchorForNode, activeAnchorId } = state;

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
  // Direction buttons
  document.querySelectorAll('.dir-btn').forEach(b => {
    b.addEventListener('click', () => {
      setFlowDir(+b.dataset.dir);
      document.querySelectorAll('.dir-btn').forEach(x => x.classList.toggle('active', x === b));
      buildPanel();
      renderOverlay();
    });
  });

  // Global sliders
  document.getElementById('fill-sl').addEventListener('input', function () {
    setFillDensity(+this.value / 100);
    document.getElementById('fill-val').textContent = this.value + '%';
    reinitParticles();
  });

  document.getElementById('speed-sl').addEventListener('input', function () {
    const v = +this.value / 100;
    setSpeedMult(v);
    document.getElementById('speed-val').textContent = v.toFixed(1) + '\u00D7';
  });

  document.getElementById('grain-sl').addEventListener('input', function () {
    setGrainSpace(+this.value);
    document.getElementById('grain-val').textContent = this.value;
  });

  document.getElementById('stretch-sl').addEventListener('input', function () {
    setStretchPct(+this.value / 100);
    document.getElementById('stretch-val').textContent = this.value + '%';
  });

  // Add node button
  document.getElementById('add-btn').addEventListener('click', () => {
    addNodeAtBestGap();
    buildPanel();
    renderOverlay();
  });

  // Add anchor button (top-level, no auto-link)
  document.getElementById('add-anchor-btn').addEventListener('click', () => {
    setPlacingAnchor(-1);  // -1 = place without linking
    buildPanel();
  });

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
