export function normA(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angDiff(a, b) {
  return Math.abs(normA(a - b));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function fmtAngle(a) {
  let d = Math.round(a * 180 / Math.PI) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d + '\u00B0';
}
