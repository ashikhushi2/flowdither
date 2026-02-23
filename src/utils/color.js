const NODE_COLORS = [
  '#ff3a8c',  // hot pink
  '#3a9fff',  // electric blue
  '#3dff8f',  // neon green
  '#ffb830',  // amber
  '#c47aff',  // violet
  '#ff5c3a',  // coral
];

export function nodeColor(idx) {
  return NODE_COLORS[idx % NODE_COLORS.length];
}

export function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
