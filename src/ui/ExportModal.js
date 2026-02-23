import { renderToCanvas, update as updateParticles } from '../core/ParticleSystem.js';
import { getState } from '../nodes/NodeManager.js';

export function initExportModal() {
  const modal = document.getElementById('export-modal');
  const exportBtn = document.getElementById('export-btn');
  const closeBtn = modal.querySelector('.modal-close');
  const formatSelect = document.getElementById('export-format');
  const bgSelect = document.getElementById('export-bg');
  const bgColor = document.getElementById('export-bg-color');
  const animOptions = modal.querySelector('.anim-options');
  const goBtn = document.getElementById('export-go');

  exportBtn.addEventListener('click', () => modal.classList.remove('hidden'));
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  formatSelect.addEventListener('change', () => {
    const isAnim = formatSelect.value !== 'png';
    animOptions.classList.toggle('hidden', !isAnim);
  });

  bgSelect.addEventListener('change', () => {
    bgColor.classList.toggle('hidden', bgSelect.value !== 'custom');
  });

  goBtn.addEventListener('click', () => doExport());
}

async function doExport() {
  const format = document.getElementById('export-format').value;
  const resMult = +document.getElementById('export-resolution').value;
  const bgSelect = document.getElementById('export-bg').value;
  const bgColorVal = document.getElementById('export-bg-color').value;
  const frameCount = +document.getElementById('export-frames').value;
  const duration = +document.getElementById('export-duration').value;

  const bg = bgSelect === 'custom' ? bgColorVal : bgSelect;

  const progress = document.getElementById('export-progress');
  const progressFill = progress.querySelector('.progress-fill');
  const progressText = progress.querySelector('.progress-text');
  const goBtn = document.getElementById('export-go');

  progress.classList.remove('hidden');
  goBtn.disabled = true;

  try {
    if (format === 'png') {
      // Single frame export
      const canvas = document.createElement('canvas');
      renderToCanvas(canvas, resMult, bg);
      progressFill.style.width = '100%';
      progressText.textContent = '100%';
      downloadCanvas(canvas, 'flow-dither.png');
    } else if (format === 'png-sequence') {
      // PNG sequence — step simulation between frames
      const frameDt = duration / frameCount;
      for (let i = 0; i < frameCount; i++) {
        updateParticles(frameDt);
        const canvas = document.createElement('canvas');
        renderToCanvas(canvas, resMult, bg);
        const pct = Math.round(((i + 1) / frameCount) * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = pct + '%';
        downloadCanvas(canvas, `flow-dither-${String(i).padStart(4, '0')}.png`);
        await new Promise(r => setTimeout(r, 50)); // small delay between downloads
      }
    } else if (format === 'gif') {
      await exportGIF(resMult, bg, frameCount, duration, (pct) => {
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

async function exportGIF(resMult, bg, frameCount, duration, onProgress) {
  // Try to use gif.js if available, otherwise fall back to simple approach
  const GIF = window.GIF || (await loadGifJs());

  if (!GIF) {
    alert('GIF export requires gif.js. Install it or use PNG sequence instead.');
    return;
  }

  const canvas = document.createElement('canvas');
  const delay = (duration / frameCount) * 1000; // ms per frame
  const frameDt = duration / frameCount;

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: 600 * resMult,
    height: 600 * resMult,
    workerScript: '/gif.worker.js',
  });

  for (let i = 0; i < frameCount; i++) {
    updateParticles(frameDt);
    renderToCanvas(canvas, resMult, bg === 'transparent' ? 'black' : bg);
    gif.addFrame(canvas, { copy: true, delay });
    onProgress(Math.round(((i + 1) / frameCount) * 80));
  }

  return new Promise((resolve, reject) => {
    gif.on('finished', blob => {
      onProgress(100);
      const a = document.createElement('a');
      a.download = 'flow-dither.gif';
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
