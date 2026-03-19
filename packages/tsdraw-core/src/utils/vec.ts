import type { Vec3 } from '../types.js';

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function sqDist(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function withinRadius(a: Vec3, b: Vec3, r: number): boolean {
  return dist(a, b) <= r;
}

export function toFixed(n: number, digits = 2): number {
  return Number(Number.prototype.toFixed.call(n, digits));
}

export function roundPt(p: Vec3): Vec3 {
  return { x: toFixed(p.x), y: toFixed(p.y), z: p.z != null ? toFixed(p.z) : undefined };
}

// Calculate bwtween two interpolated points
export function lerpPath(from: Vec3, to: Vec3, steps: number): Vec3[] {
  if (steps <= 0) return [{ x: toFixed(from.x), y: toFixed(from.y), z: from.z }];
  const result: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    result.push({
      x: toFixed(from.x + (to.x - from.x) * t),
      y: toFixed(from.y + (to.y - from.y) * t),
      z: from.z != null && to.z != null ? toFixed(from.z + (to.z - from.z) * t) : to.z ?? from.z,
    });
  }
  return result;
}

// Snap angle to the nearest division
export function quantizeAngle(rad: number, divisions: number): number {
  const step = (Math.PI * 2) / divisions;
  return Math.round(rad / step) * step;
}

// Rotate point around an origin
export function rotateAround(pt: Vec3, origin: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = pt.x - origin.x;
  const ry = pt.y - origin.y;
  return {
    x: origin.x + rx * c - ry * s,
    y: origin.y + rx * s + ry * c,
    z: pt.z,
  };
}

export function tail<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}
