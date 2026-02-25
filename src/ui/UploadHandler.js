import { parseSVG } from '../core/ShapeParser.js';
import { DistanceField } from '../core/DistanceField.js';
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

    // Notify main.js which will addAsset + selectAsset
    if (onShapeChange) onShapeChange(shape, sdf, fileName);

    console.log(`Loaded shape: ${fileName || 'SVG'} (${shape.numPoints} boundary points)`);
  } catch (err) {
    console.error('Failed to parse SVG:', err);
    alert('Failed to parse SVG: ' + err.message);
  }
}

export function initUploadHandler() {
  const fileInput = document.getElementById('file-input');

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => loadSVGString(evt.target.result, file.name);
    reader.readAsText(file);
    fileInput.value = '';
  });

  // Drag and drop on canvas area
  const canvasWrap = document.getElementById('canvas-wrap');
  if (canvasWrap) {
    canvasWrap.addEventListener('dragover', e => {
      e.preventDefault();
    });

    canvasWrap.addEventListener('drop', e => {
      e.preventDefault();
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
}
