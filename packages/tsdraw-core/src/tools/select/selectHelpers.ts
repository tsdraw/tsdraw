import { decodePoints, encodePoints, decodePathToPoints } from '../../utils/pathCodec.js';
import { STROKE_WIDTHS, type DrawShape, type DrawSegment, type ShapeId, type Vec3 } from '../../types.js';
import type { Editor } from '../../editor/Editor.js';

export interface SelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

export interface TransformSnapshot {
  x: number;
  y: number;
  segments: Array<{ type: DrawSegment['type']; points: Vec3[] }>;
}

export function isSelectTool(tool: string): boolean {
  return tool === 'select';
}

export function getShapeBounds(shape: DrawShape): SelectionBounds {
  const points = decodePathToPoints(shape.props.segments, shape.x, shape.y);
  if (points.length === 0) {
    return { minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y };
  }

  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = minX;
  let maxY = minY;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const stroke = (STROKE_WIDTHS[shape.props.size] ?? 3.5) * shape.props.scale;
  return { minX: minX - stroke, minY: minY - stroke, maxX: maxX + stroke, maxY: maxY + stroke };
}

export function normalizeSelectionBounds(
  a: { x: number; y: number },
  b: { x: number; y: number }
): SelectionBounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function boundsContainPoint(bounds: SelectionBounds, x: number, y: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

export function boundsIntersect(a: SelectionBounds, b: SelectionBounds): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export function rotatePoint(point: { x: number; y: number }, center: { x: number; y: number }, radians: number) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return {
    x: center.x + dx * c - dy * s,
    y: center.y + dx * s + dy * c,
  };
}

export function buildTransformSnapshots(editor: Editor, ids: ShapeId[]): Map<ShapeId, TransformSnapshot> {
  const snapshots = new Map<ShapeId, TransformSnapshot>();
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape || shape.type !== 'draw') continue;
    snapshots.set(id, {
      x: shape.x,
      y: shape.y,
      segments: shape.props.segments.map((seg) => ({
        type: seg.type,
        points: decodePoints(seg.path),
      })),
    });
  }
  return snapshots;
}

export function buildStartPositions(editor: Editor, ids: ShapeId[]): Map<ShapeId, { x: number; y: number }> {
  const positions = new Map<ShapeId, { x: number; y: number }>();
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    positions.set(id, { x: shape.x, y: shape.y });
  }
  return positions;
}

export function getTopShapeAtPoint(editor: Editor, point: { x: number; y: number }) {
  const margin = 6 / editor.viewport.zoom;
  const shapes = editor.getCurrentPageRenderingShapesSorted();

  // Iterate in rendering order so first hit matches top shape
  for (const shape of shapes) {
    if (shape.type !== 'draw') continue;
    const b = getShapeBounds(shape);
    if (
      boundsContainPoint(
        {
          minX: b.minX - margin,
          minY: b.minY - margin,
          maxX: b.maxX + margin,
          maxY: b.maxY + margin,
        },
        point.x,
        point.y
      )
    ) {
      return shape;
    }
  }

  return null;
}

export function getSelectionBoundsPage(editor: Editor, ids: ShapeId[]): SelectionBounds | null {
  if (ids.length === 0) return null;

  let union: SelectionBounds | null = null;
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape || shape.type !== 'draw') continue;
    const b = getShapeBounds(shape);
    union = union
      ? {
          minX: Math.min(union.minX, b.minX),
          minY: Math.min(union.minY, b.minY),
          maxX: Math.max(union.maxX, b.maxX),
          maxY: Math.max(union.maxY, b.maxY),
        }
      : b;
  }

  return union;
}

export function getShapesInBounds(editor: Editor, bounds: SelectionBounds): ShapeId[] {
  return editor
    .getCurrentPageShapesSorted()
    .filter((shape): shape is DrawShape => shape.type === 'draw')
    .filter((shape) => boundsIntersect(getShapeBounds(shape), bounds))
    .map((shape) => shape.id);
}

export function applyMove(
  editor: Editor,
  startPositions: Map<ShapeId, { x: number; y: number }>,
  deltaX: number,
  deltaY: number
) {
  for (const [id, start] of startPositions) {
    editor.store.updateShape(id, {
      x: start.x + deltaX,
      y: start.y + deltaY,
    });
  }
}

export function applyRotation(
  editor: Editor,
  startShapes: Map<ShapeId, TransformSnapshot>,
  center: { x: number; y: number },
  delta: number
) {
  for (const [id, snapshot] of startShapes) {
    const shape = editor.getShape(id);
    if (!shape || shape.type !== 'draw') continue;

    const rotatedOrigin = rotatePoint({ x: snapshot.x, y: snapshot.y }, center, delta);
    // Rotate absolute points around selection center, then re-localize back into the shapes coordinate space
    const segments = snapshot.segments.map((segment) => ({
      type: segment.type,
      path: encodePoints(
        segment.points.map((pt) => {
          const absolute = { x: snapshot.x + pt.x, y: snapshot.y + pt.y };
          const rotated = rotatePoint(absolute, center, delta);
          return {
            x: rotated.x - rotatedOrigin.x,
            y: rotated.y - rotatedOrigin.y,
            z: pt.z,
          };
        })
      ),
    }));

    editor.store.updateShape(id, {
      x: rotatedOrigin.x,
      y: rotatedOrigin.y,
      props: { ...shape.props, segments },
    });
  }
}

export function applyResize(
  editor: Editor,
  handle: ResizeHandle,
  startBounds: SelectionBounds,
  startShapes: Map<ShapeId, TransformSnapshot>,
  pointer: { x: number; y: number },
  lockAspectRatio: boolean
) {
  const minSize = 8 / editor.viewport.zoom;
  const startW = Math.max(0.0001, startBounds.maxX - startBounds.minX);
  const startH = Math.max(0.0001, startBounds.maxY - startBounds.minY);
  const aspectRatio = startW / startH;

  let minX = startBounds.minX;
  let minY = startBounds.minY;
  let maxX = startBounds.maxX;
  let maxY = startBounds.maxY;

  switch (handle) {
    case 'nw':
      minX = Math.min(pointer.x, startBounds.maxX - minSize);
      minY = Math.min(pointer.y, startBounds.maxY - minSize);
      break;
    case 'ne':
      maxX = Math.max(pointer.x, startBounds.minX + minSize);
      minY = Math.min(pointer.y, startBounds.maxY - minSize);
      break;
    case 'sw':
      minX = Math.min(pointer.x, startBounds.maxX - minSize);
      maxY = Math.max(pointer.y, startBounds.minY + minSize);
      break;
    case 'se':
      maxX = Math.max(pointer.x, startBounds.minX + minSize);
      maxY = Math.max(pointer.y, startBounds.minY + minSize);
      break;
  }

  if (lockAspectRatio) {
    // Keep dragged corner constrained to the original ratio while opposite corner stays to be the stationary anchor resize
    let nextW = Math.max(minSize, maxX - minX);
    let nextH = Math.max(minSize, maxY - minY);

    if (nextW / nextH > aspectRatio) {
      nextH = nextW / aspectRatio;
    } else {
      nextW = nextH * aspectRatio;
    }

    if (nextW < minSize) {
      nextW = minSize;
      nextH = nextW / aspectRatio;
    }

    if (nextH < minSize) {
      nextH = minSize;
      nextW = nextH * aspectRatio;
    }

    switch (handle) {
      case 'nw':
        minX = startBounds.maxX - nextW;
        minY = startBounds.maxY - nextH;
        maxX = startBounds.maxX;
        maxY = startBounds.maxY;
        break;
      case 'ne':
        minX = startBounds.minX;
        minY = startBounds.maxY - nextH;
        maxX = startBounds.minX + nextW;
        maxY = startBounds.maxY;
        break;
      case 'sw':
        minX = startBounds.maxX - nextW;
        minY = startBounds.minY;
        maxX = startBounds.maxX;
        maxY = startBounds.minY + nextH;
        break;
      case 'se':
        minX = startBounds.minX;
        minY = startBounds.minY;
        maxX = startBounds.minX + nextW;
        maxY = startBounds.minY + nextH;
        break;
    }
  }

  const newBounds: SelectionBounds = { minX, minY, maxX, maxY };
  const sx = (newBounds.maxX - newBounds.minX) / startW;
  const sy = (newBounds.maxY - newBounds.minY) / startH;

  for (const [id, snapshot] of startShapes) {
    const shape = editor.getShape(id);
    if (!shape || shape.type !== 'draw') continue;
    const nextX = newBounds.minX + (snapshot.x - startBounds.minX) * sx;
    const nextY = newBounds.minY + (snapshot.y - startBounds.minY) * sy;
    const segments = snapshot.segments.map((segment) => ({
      type: segment.type,
      path: encodePoints(
        segment.points.map((p) => ({
          x: p.x * sx,
          y: p.y * sy,
          z: p.z,
        }))
      ),
    }));

    editor.store.updateShape(id, {
      x: nextX,
      y: nextY,
      props: { ...shape.props, segments },
    });
  }
}
