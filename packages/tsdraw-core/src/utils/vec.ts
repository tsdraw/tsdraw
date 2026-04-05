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

// Calculate bwtween two interpolated points
export function lerpPath(from: Vec3, to: Vec3, steps: number): Vec3[] {
  if (steps <= 0) return [{ x: from.x, y: from.y, z: from.z }];
  const result: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    result.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z != null && to.z != null ? from.z + (to.z - from.z) * t : to.z ?? from.z,
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

// Perpendicular distance from point p to the line
export function perpendicularDist(p: Vec3, lineStart: Vec3, lineEnd: Vec3): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return dist(p, lineStart);
  const cross = Math.abs((p.x - lineStart.x) * dy - (p.y - lineStart.y) * dx);
  return cross / Math.sqrt(lengthSq);
}

// Ramer-Douglas-Peucker polyline simplification which returns indices of kept points. References:
// https://martinfleischmann.net/line-simplification-algorithms/
// https://cartography-playground.gitlab.io/playgrounds/douglas-peucker-algorithm/
export function rdpSimplify(points: Vec3[], epsilon: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist <= epsilon) return [0, points.length - 1];

  const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
  const right = rdpSimplify(points.slice(maxIdx), epsilon);
  const rightShifted = right.slice(1).map((i) => i + maxIdx);

  return [...left, ...rightShifted];
}

// Angle between two vectors (a-b and a-c)
export function angleBetween(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const dot = abx * acx + aby * acy;
  const cross = abx * acy - aby * acx;
  return Math.abs(Math.atan2(cross, dot));
}

// Index of the point in `points` closest to `target` by Euclidean distance
export function nearestPointIndex(points: Vec3[], target: Vec3): number {
  let bestIdx = 0;
  let bestSq = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i]!.x - target.x;
    const dy = points[i]!.y - target.y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) { bestSq = sq; bestIdx = i; }
  }
  return bestIdx;
}

// Axis-aligned bounding box
export function boundingBox(points: Vec3[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Total polyline arc length
export function pathLength(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1]!, points[i]!);
  }
  return total;
}

// Finds closest node within radius (page-space) or null
export function snapToNearestNode(pagePoint: Vec3, nodes: Vec3[], radius: number): Vec3 | null {
  let bestDist = radius;
  let best: Vec3 | null = null;
  for (const node of nodes) {
    const d = dist(pagePoint, node);
    if (d < bestDist) { bestDist = d; best = node; }
  }
  return best ? { x: best.x, y: best.y, z: pagePoint.z } : null;
}
