import { parseSVG } from '../core/ShapeParser.js';
import { DistanceField } from '../core/DistanceField.js';
import { setShape } from '../nodes/NodeManager.js';
import { renderOverlay } from '../nodes/NodeOverlay.js';
import { buildPanel } from './Panel.js';

let onShapeChange = null;

export function setOnShapeChange(cb) {
  onShapeChange = cb;
}

function loadSVGString(svgString, fileName) {
  try {
    const shape = parseSVG(svgString);
    const sdf = new DistanceField(shape);
    sdf.compute();
    setShape(shape, sdf);

    buildPanel();
    renderOverlay();
    if (onShapeChange) onShapeChange();

    console.log(`Loaded shape: ${fileName || 'SVG'} (${shape.numPoints} boundary points)`);
  } catch (err) {
    console.error('Failed to parse SVG:', err);
    alert('Failed to parse SVG: ' + err.message);
  }
}

export function initUploadHandler() {
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');

  // File picker
  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => loadSVGString(evt.target.result, file.name);
    reader.readAsText(file);
    fileInput.value = '';
  });

  // Drag and drop
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.svg')) {
      alert('Please drop an SVG file');
      return;
    }
    const reader = new FileReader();
    reader.onload = evt => loadSVGString(evt.target.result, file.name);
    reader.readAsText(file);
  });
}
