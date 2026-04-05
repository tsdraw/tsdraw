import { decodePoints, encodePoints } from '../../utils/pathCodec.js';
import type { DrawShape, ShapeId } from '../../types.js';
import { dist } from '../../utils/vec.js';
import type { Editor } from '../../editor/Editor.js';
import type { TransformSnapshot } from './selectHelpers.js';
import { buildTransformSnapshots } from './selectHelpers.js';

// Segment endpoint (start/end only); interior path points are not editable as vertices.
export interface VertexRef {
  shapeId: ShapeId;
  segmentIndex: number;
  endpoint: 'start' | 'end';
}

function listRefsForShape(shape: DrawShape): VertexRef[] {
  const refs: VertexRef[] = [];
  for (let segmentIndex = 0; segmentIndex < shape.props.segments.length; segmentIndex++) {
    const pts = decodePoints(shape.props.segments[segmentIndex]!.path);
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      refs.push({ shapeId: shape.id, segmentIndex, endpoint: 'start' });
      continue;
    }
    refs.push({ shapeId: shape.id, segmentIndex, endpoint: 'start' });
    refs.push({ shapeId: shape.id, segmentIndex, endpoint: 'end' });
  }
  return refs;
}

export function pagePointForVertexRef(shape: DrawShape, ref: VertexRef): { x: number; y: number } {
  const pts = decodePoints(shape.props.segments[ref.segmentIndex]!.path);
  const pt = ref.endpoint === 'start' ? pts[0]! : pts[pts.length - 1]!;
  return { x: shape.x + pt.x, y: shape.y + pt.y };
}

// Refs whose endpoint lies within `tolerance` (page units) of `anchorPage`.
export function collectRefsNearAnchor(editor: Editor, anchorPage: { x: number; y: number }, tolerance: number): VertexRef[] {
  const out: VertexRef[] = [];
  for (const shape of editor.getCurrentPageShapesSorted()) {
    if (shape.type !== 'draw') continue;
    const draw = shape as DrawShape;
    for (const ref of listRefsForShape(draw)) {
      const pg = pagePointForVertexRef(draw, ref);
      const d = dist(
        { x: anchorPage.x, y: anchorPage.y, z: 0.5 },
        { x: pg.x, y: pg.y, z: 0.5 }
      );
      if (d <= tolerance) out.push(ref);
    }
  }
  return out;
}

// Hit-test endpoints (topmost shape first); returns refs sharing one cluster. marginPage = pick radius; clusterTolerance >= merge radius for coincident nodes (e.g. 20/zoom).
export function findVertexHit(editor: Editor, pagePoint: { x: number; y: number }, marginPage: number, clusterTolerance: number): { refs: VertexRef[]; anchorPage: { x: number; y: number }; snapshots: Map<ShapeId, TransformSnapshot> } | null {
  const shapes = editor.getCurrentPageRenderingShapesSorted();
  for (const shape of shapes) {
    if (shape.type !== 'draw') continue;
    const draw = shape as DrawShape;
    let best: { dist: number; anchorPage: { x: number; y: number } } | null = null;
    for (const ref of listRefsForShape(draw)) {
      const pg = pagePointForVertexRef(draw, ref);
      const d = dist(
        { x: pagePoint.x, y: pagePoint.y, z: 0.5 },
        { x: pg.x, y: pg.y, z: 0.5 }
      );
      if (d <= marginPage && (!best || d < best.dist)) {
        best = { dist: d, anchorPage: pg };
      }
    }
    if (best) {
      const refs = collectRefsNearAnchor(editor, best.anchorPage, clusterTolerance);
      const ids = [...new Set(refs.map((r) => r.shapeId))];
      const snapshots = buildTransformSnapshots(editor, ids);
      return { refs, anchorPage: best.anchorPage, snapshots };
    }
  }
  return null;
}

export function applyVertexDrag(editor: Editor, snapshots: Map<ShapeId, TransformSnapshot>, refs: VertexRef[], deltaPage: { x: number; y: number }): void {
  const byShape = new Map<ShapeId, VertexRef[]>();
  for (const ref of refs) {
    const list = byShape.get(ref.shapeId) ?? [];
    list.push(ref);
    byShape.set(ref.shapeId, list);
  }

  for (const [shapeId, shapeRefs] of byShape) {
    const snap = snapshots.get(shapeId);
    if (!snap) continue;
    const shape = editor.getShape(shapeId) as DrawShape | undefined;
    if (!shape || shape.type !== 'draw') continue;

    const segments = snap.segments.map((seg) => ({
      type: seg.type,
      points: seg.points.map((p) => ({ ...p })),
    }));

    for (const ref of shapeRefs) {
      const origPts = snap.segments[ref.segmentIndex]?.points;
      const segPts = segments[ref.segmentIndex]?.points;
      if (!origPts || !segPts) continue;
      const idx = ref.endpoint === 'start' ? 0 : segPts.length - 1;
      const local = origPts[idx]!;
      segPts[idx] = {
        x: local.x + deltaPage.x,
        y: local.y + deltaPage.y,
        z: local.z,
      };
    }

    const nextSegments = snap.segments.map((snapSeg, i) => ({
      type: snapSeg.type,
      path: encodePoints(segments[i]!.points),
    }));

    editor.store.updateShape(shapeId, {
      props: { ...shape.props, segments: nextSegments },
    });
  }
}

const VERTEX_HANDLE_DEDUPE_EPS = 0.5; // page units; bucket coords to merge coincident endpoints for one dot

// Unique page positions for segment endpoints (selection overlay dots).
export function getVertexHandlePagePositions(editor: Editor, shapeIds: ShapeId[]): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const id of shapeIds) {
    const shape = editor.getShape(id) as DrawShape | undefined;
    if (!shape || shape.type !== 'draw') continue;
    for (const ref of listRefsForShape(shape)) {
      const pg = pagePointForVertexRef(shape, ref);
      const key = `${Math.round(pg.x / VERTEX_HANDLE_DEDUPE_EPS)},${Math.round(pg.y / VERTEX_HANDLE_DEDUPE_EPS)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(pg);
    }
  }
  return out;
}
