import type { DrawSegment, Vec3 } from '../../types.js';
import { encodePoints } from '../../utils/pathCodec.js';

// Helpers for geometric shape tools
// Each tool provides "constrained" and "unconstrained" bound-builders
// Constrained forces equal aspect ratio sides (shift), unconstrained allows freeform
// Segment-builders turn those bounds into encoded draw segments

export interface ShapeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIDE_LENGTH = 1;

// Turn anchor + cursor into a bounding box, optionally forcing both axes to the longer side to get a square or circle
function toSizedBounds(
  anchorX: number,
  anchorY: number,
  cursorX: number,
  cursorY: number,
  forceEqualSides: boolean
): ShapeBounds {
  const rawDeltaX = cursorX - anchorX;
  const rawDeltaY = cursorY - anchorY;
  const sideLength = Math.max(Math.abs(rawDeltaX), Math.abs(rawDeltaY), MIN_SIDE_LENGTH);

  if (forceEqualSides) {
    const nextDeltaX = rawDeltaX < 0 ? -sideLength : sideLength;
    const nextDeltaY = rawDeltaY < 0 ? -sideLength : sideLength;
    return normalizeBounds(anchorX, anchorY, anchorX + nextDeltaX, anchorY + nextDeltaY);
  }

  return normalizeBounds(anchorX, anchorY, cursorX, cursorY);
}

function normalizeBounds(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): ShapeBounds {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.max(Math.abs(endX - startX), MIN_SIDE_LENGTH);
  const height = Math.max(Math.abs(endY - startY), MIN_SIDE_LENGTH);
  return { x, y, width, height };
}

export function buildSquareBounds(
  anchorX: number,
  anchorY: number,
  cursorX: number,
  cursorY: number
): ShapeBounds {
  return toSizedBounds(anchorX, anchorY, cursorX, cursorY, true);
}

export function buildRectangleBounds(
  anchorX: number,
  anchorY: number,
  cursorX: number,
  cursorY: number
): ShapeBounds {
  return toSizedBounds(anchorX, anchorY, cursorX, cursorY, false);
}

// Four straight segments connecting the corners. encoded as draw segments so
// the renderer handles them exactly like hand-drawn strokes.
export function buildRectangleSegments(width: number, height: number): DrawSegment[] {
  const topLeft: Vec3 = { x: 0, y: 0, z: 0.5 };
  const topRight: Vec3 = { x: width, y: 0, z: 0.5 };
  const bottomRight: Vec3 = { x: width, y: height, z: 0.5 };
  const bottomLeft: Vec3 = { x: 0, y: height, z: 0.5 };
  return [
    { type: 'straight', path: encodePoints([topLeft, topRight]) },
    { type: 'straight', path: encodePoints([topRight, bottomRight]) },
    { type: 'straight', path: encodePoints([bottomRight, bottomLeft]) },
    { type: 'straight', path: encodePoints([bottomLeft, topLeft]) },
  ];
}

export function buildCircleBounds(
  anchorX: number,
  anchorY: number,
  cursorX: number,
  cursorY: number
): ShapeBounds {
  return toSizedBounds(anchorX, anchorY, cursorX, cursorY, true);
}

export function buildEllipseBounds(
  anchorX: number,
  anchorY: number,
  cursorX: number,
  cursorY: number
): ShapeBounds {
  return toSizedBounds(anchorX, anchorY, cursorX, cursorY, false);
}

// Approximate the ellipse as a 64-sample polyline encoded as a single "free" segment.
// good enough visually and means we can reuse all the same rendering/hit-testing
// that works for regular draw strokes.
export function buildEllipseSegments(width: number, height: number): DrawSegment[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const sampleCount = 64;
  const sampledPoints: Vec3[] = [];

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const progress = sampleIndex / sampleCount;
    const angle = progress * Math.PI * 2;
    sampledPoints.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
      z: 0.5,
    });
  }

  return [{ type: 'free', path: encodePoints(sampledPoints) }];
}

// Build straight segments between consecutive vertices, with possible closing the segment back to the first point
export function buildPolylineSegments(vertices: Vec3[], closed: boolean): DrawSegment[] {
  const segments: DrawSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({
      type: 'straight',
      path: encodePoints([vertices[i]!, vertices[i + 1]!]),
    });
  }
  if (closed && vertices.length >= 3) {
    segments.push({
      type: 'straight',
      path: encodePoints([vertices[vertices.length - 1]!, vertices[0]!]),
    });
  }
  return segments;
}