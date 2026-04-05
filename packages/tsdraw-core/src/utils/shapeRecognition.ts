import type { Vec3, ShapeId } from '../types.js';
import { dist, rdpSimplify, angleBetween, nearestPointIndex, boundingBox, pathLength } from './vec.js';

// Recognition thresholds (subject to change)

export const RDP_EPSILON = 0.045; // RDP tolerance vs bbox diagonal (higher -> fewer verts)
export const VERTEX_MERGE_DIST = 0.05; // merge adjacent verts closer than this x diagonal
export const CLOSURE_PATH_RATIO = 0.10; // max start-end gap vs stroke length
export const CLOSURE_DIAGONAL_RATIO = 0.18; // max start-end gap vs bbox diagonal
export const CLOSURE_AUTO_POLYGON_RATIO = 0.35; // loose diagonal ratio for auto closing polygon
export const ELLIPSE_FIT_TOLERANCE = 0.35; // max mean |(x/a)²+(y/b)²−1|
export const RECT_ANGLE_TOLERANCE = Math.PI * 0.22; // max deviation from 90° per corner
export const MIN_PATH_LENGTH = 4; // min arc length (px) before recognition

// Speed refinement thresholds

export const SPEED_DIP_RATIO = 0.4; // speed below this × median = pause dip
export const SPEED_DIP_RADIUS = 8; // raw index radius to search near an RDP vertex
export const SHARP_ANGLE_LIMIT = Math.PI * 0.65; // keep vertex w/o dip if angle sharper than this
export const SPEED_VARIANCE_THRESHOLD = 0.5; // min speed CV for meaningful timing

export type RecognizedShape = RecognizedPolyline | RecognizedEllipse;

export interface RecognizedPolyline {
  kind: 'polyline';
  vertices: Vec3[];
  closed: boolean;
  activeVertexIdx: number;
  rectangleAnchorIdx?: number; // diagonally opposite corner when snapped to rectangle
}

export interface RecognizedEllipse {
  kind: 'ellipse';
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export interface RecognitionEntryInfo {
  shapeId: ShapeId;
  recognized: RecognizedShape;
}

export type AutoShapeKind = 'polyline' | 'polygon' | 'rectangle' | 'ellipse';

export interface AutoShapeThresholds {
  rdpEpsilon: number;
  vertexMergeDist: number;
  closurePathRatio: number;
  closureDiagonalRatio: number;
  closureAutoPolygonRatio: number; // looser diagonal threshold for auto-closing unclosed polygons
  ellipseFitTolerance: number;
  rectAngleTolerance: number;
  minPathLength: number;
  speedDipRatio: number;
  speedDipRadius: number;
  sharpAngleLimit: number;
  speedVarianceThreshold: number;
}

export const DEFAULT_AUTO_SHAPE_THRESHOLDS: Readonly<AutoShapeThresholds> = {
  rdpEpsilon: RDP_EPSILON,
  vertexMergeDist: VERTEX_MERGE_DIST,
  closurePathRatio: CLOSURE_PATH_RATIO,
  closureDiagonalRatio: CLOSURE_DIAGONAL_RATIO,
  closureAutoPolygonRatio: CLOSURE_AUTO_POLYGON_RATIO,
  ellipseFitTolerance: ELLIPSE_FIT_TOLERANCE,
  rectAngleTolerance: RECT_ANGLE_TOLERANCE,
  minPathLength: MIN_PATH_LENGTH,
  speedDipRatio: SPEED_DIP_RATIO,
  speedDipRadius: SPEED_DIP_RADIUS,
  sharpAngleLimit: SHARP_ANGLE_LIMIT,
  speedVarianceThreshold: SPEED_VARIANCE_THRESHOLD,
};

export interface AutoShapeOptions {
  enabled?: boolean; // default true
  whitelist?: AutoShapeKind[]; // undefined = all shapes
  thresholds?: Partial<AutoShapeThresholds>;
}

function resolveThresholds(overrides?: Partial<AutoShapeThresholds>): AutoShapeThresholds {
  if (!overrides) return DEFAULT_AUTO_SHAPE_THRESHOLDS as AutoShapeThresholds;
  return { ...DEFAULT_AUTO_SHAPE_THRESHOLDS, ...overrides };
}

// Figure out what shape the stroke is and return a RecognizedShape if it's a shape
export function recognizeShape(
  points: Vec3[],
  timestamps?: number[],
  config?: AutoShapeOptions,
): RecognizedShape | null {
  if (points.length < 3) return null;
  const t = resolveThresholds(config?.thresholds);
  const allowed = config?.whitelist; // undefined = all shapes

  const totalLen = pathLength(points);
  if (totalLen < t.minPathLength) return null;

  const bb = boundingBox(points);
  const diagonal = Math.hypot(bb.width, bb.height);
  if (diagonal < 2) return null;

  const closingGap = dist(points[0]!, points[points.length - 1]!); // closure on raw endpoints
  const isClosed = closingGap < totalLen * t.closurePathRatio && closingGap < diagonal * t.closureDiagonalRatio;

  if (isClosed) {
    const ellipse = tryEllipse(points, bb, t.ellipseFitTolerance); // raw points, no RDP verts yet
    if (ellipse && (!allowed || allowed.includes('ellipse'))) return ellipse;
  }

  const epsilon = diagonal * t.rdpEpsilon; // RDP, optionally refined by speed below
  const rdpIndices = rdpSimplify(points, epsilon);

  const canRefineWithSpeed = timestamps != null && timestamps.length === points.length && points.length > 6;
  const keyIndices = canRefineWithSpeed ? refineVerticesWithSpeed(rdpIndices, points, timestamps!, t) : rdpIndices;

  const rawVertices = keyIndices.map((i) => points[i]!);
  const vertices = filterCloseVertices(rawVertices, diagonal * t.vertexMergeDist);
  if (vertices.length < 2) return null;

  const cursorPoint = points[points.length - 1]!;

  // Close shapes user drew start -> end strictly
  if (isClosed && vertices.length >= 3) {
    const merged = snapClosedVertices(vertices);
    return returnClosedPolygon(merged, cursorPoint, allowed, t);
  }

  // Auto close endpoints within loose polygon threshold
  const canAutoClose = (!allowed || allowed.includes('polygon')) && vertices.length >= 3 && closingGap < diagonal * t.closureAutoPolygonRatio;
  if (canAutoClose) { return returnClosedPolygon(vertices, cursorPoint, allowed, t); }

  if (allowed && !allowed.includes('polyline')) return null;
  return { kind: 'polyline', vertices, closed: false, activeVertexIdx: nearestPointIndex(vertices, cursorPoint) };
}

function returnClosedPolygon(
  vertices: Vec3[],
  cursorPoint: Vec3,
  allowed: AutoShapeKind[] | undefined,
  t: AutoShapeThresholds,
): RecognizedShape | null {
  if (!allowed || allowed.includes('rectangle')) {
    const rect = tryRectangleSnap(vertices, t.rectAngleTolerance);
    if (rect) {
      const activeIdx = nearestPointIndex(rect, cursorPoint);
      return { kind: 'polyline', vertices: rect, closed: true, activeVertexIdx: activeIdx, rectangleAnchorIdx: (activeIdx + 2) % 4 };
    }
  }
  if (allowed && !allowed.includes('polygon')) return null;
  return { kind: 'polyline', vertices, closed: true, activeVertexIdx: nearestPointIndex(vertices, cursorPoint) };
}

// Speed vertex refinements

// Removes RDP verts near smooth fast strokes unless its a sharp turn, stopping it from turning into a polygon
function refineVerticesWithSpeed(rdpIndices: number[], points: Vec3[], timestamps: number[], t: AutoShapeThresholds): number[] {
  if (rdpIndices.length <= 2) return rdpIndices;

  const speeds = computeSpeeds(points, timestamps);
  const analysis = analyzeSpeedProfile(speeds, points.length, t.speedVarianceThreshold, t.speedDipRatio);
  if (!analysis) return rdpIndices;
  const { dipSet } = analysis;

  const refined: number[] = [rdpIndices[0]!];
  for (let k = 1; k < rdpIndices.length - 1; k++) {
    const idx = rdpIndices[k]!;
    if (hasNearbyDip(idx, dipSet, points.length, t.speedDipRadius)) {
      refined.push(idx);
      continue;
    }
    const angle = angleBetween(points[idx]!, points[rdpIndices[k - 1]!]!, points[rdpIndices[k + 1]!]!); // no dip: corner only if sharp
    if (angle < t.sharpAngleLimit) {
      refined.push(idx);
    }
  }
  refined.push(rdpIndices[rdpIndices.length - 1]!);
  return refined;
}

function computeSpeeds(points: Vec3[], timestamps: number[]): number[] {
  const speeds: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dt = timestamps[i]! - timestamps[i - 1]!;
    speeds.push(dt > 0 ? dist(points[i]!, points[i - 1]!) / dt : (speeds[i - 1] ?? 0));
  }
  return speeds;
}

function analyzeSpeedProfile(speeds: number[], totalPoints: number, varianceThreshold: number, dipRatio: number): { dipSet: Set<number> } | null { // trim, variance, dips; null if uniform
  const trimStart = Math.max(1, Math.floor(totalPoints * 0.1));
  const trimEnd = Math.min(totalPoints - 1, Math.ceil(totalPoints * 0.9));
  if (trimEnd - trimStart < 5) return null;

  const trimmed: number[] = [];
  for (let i = trimStart; i < trimEnd; i++) {
    if (speeds[i]! > 0) trimmed.push(speeds[i]!);
  }
  if (trimmed.length < 5) return null;

  const mean = trimmed.reduce((s, v) => s + v, 0) / trimmed.length; // coefficient of variation gate
  if (mean < 0.001) return null;
  const variance = trimmed.reduce((s, v) => s + (v - mean) ** 2, 0) / trimmed.length;
  if (Math.sqrt(variance) / mean < varianceThreshold) return null;

  trimmed.sort((a, b) => a - b);
  const median = trimmed[Math.floor(trimmed.length / 2)]!;
  const threshold = median * dipRatio;

  const dipSet = new Set<number>();
  for (let i = trimStart; i < trimEnd; i++) {
    if (speeds[i]! > 0 && speeds[i]! < threshold) dipSet.add(i); // slower than median x ratio
  }
  return dipSet.size > 0 ? { dipSet } : null;
}

function hasNearbyDip(idx: number, dipSet: Set<number>, totalPoints: number, radius: number): boolean {
  const lo = Math.max(0, idx - radius);
  const hi = Math.min(totalPoints - 1, idx + radius);
  for (let j = lo; j <= hi; j++) {
    if (dipSet.has(j)) return true;
  }
  return false;
}

function filterCloseVertices(vertices: Vec3[], minDist: number): Vec3[] { // drop interior verts too close to prev
  if (vertices.length <= 2) return vertices;
  const result: Vec3[] = [vertices[0]!];
  for (let i = 1; i < vertices.length - 1; i++) {
    if (dist(vertices[i]!, result[result.length - 1]!) >= minDist) {
      result.push(vertices[i]!);
    }
  }
  result.push(vertices[vertices.length - 1]!);
  return result;
}

function snapClosedVertices(vertices: Vec3[]): Vec3[] { // drop duplicate last; end snaps to start
  if (vertices.length < 3) return vertices;
  const start = vertices[0]!;
  const merged: Vec3[] = [{ x: start.x, y: start.y, z: 0.5 }];
  for (let i = 1; i < vertices.length - 1; i++) merged.push(vertices[i]!);
  return merged;
}

function tryRectangleSnap(vertices: Vec3[], angleTolerance: number): Vec3[] | null { // ≈90° corners -> axis-aligned bbox quad
  if (vertices.length !== 4) return null;
  const RIGHT = Math.PI / 2;
  let rightCount = 0;
  for (let i = 0; i < 4; i++) {
    const angle = angleBetween(vertices[i]!, vertices[(i + 3) % 4]!, vertices[(i + 1) % 4]!);
    if (Math.abs(angle - RIGHT) < angleTolerance) rightCount++;
  }
  if (rightCount < 3) return null;
  const bb = boundingBox(vertices);
  return [
    { x: bb.x, y: bb.y, z: 0.5 },
    { x: bb.x + bb.width, y: bb.y, z: 0.5 },
    { x: bb.x + bb.width, y: bb.y + bb.height, z: 0.5 },
    { x: bb.x, y: bb.y + bb.height, z: 0.5 },
  ];
}

function tryEllipse(
  points: Vec3[],
  bb: { x: number; y: number; width: number; height: number },
  fitTolerance: number,
): RecognizedEllipse | null { // normalized ellipse equation fit vs bbox
  const w = Math.max(bb.width, 1);
  const h = Math.max(bb.height, 1);
  const cx = bb.x + w / 2;
  const cy = bb.y + h / 2;
  const a2 = (w / 2) ** 2;
  const b2 = (h / 2) ** 2;
  if (a2 < 9 || b2 < 9) return null;

  let totalDeviation = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    totalDeviation += Math.abs((dx * dx) / a2 + (dy * dy) / b2 - 1);
  }
  if (totalDeviation / points.length > fitTolerance) return null;
  return { kind: 'ellipse', cx, cy, width: w, height: h };
}
