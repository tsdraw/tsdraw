import {
  StateNode,
  type ToolKeyInfo,
  type ToolPointerDownInfo,
} from '../../../store/stateNode.js';
import type { DrawShape, DrawSegment, Vec3 } from '../../../types.js';
import { STROKE_WIDTHS, MAX_POINTS_PER_SHAPE } from '../../../types.js';
import { encodePoints, decodePoints, decodeFirstPoint, decodeLastPoint } from '../../../utils/pathCodec.js';
import { dist, sqDist, withinRadius, lerpPath, tail, quantizeAngle, rotateAround, boundingBox } from '../../../utils/vec.js';
import { recognizeShape, type RecognizedShape, type RecognitionEntryInfo } from '../../../utils/shapeRecognition.js';
import { buildPolylineSegments, buildEllipseSegments, CLOSURE_VERTEX_SNAP_PX } from '../../geometric/geometricShapeHelpers.js';

type StrokePhase = 'free' | 'straight' | 'starting_straight' | 'starting_free';

const DWELL_TIMEOUT_MS = 600; // start shape snapping 600ms after last move
const DWELL_MOVE_THRESHOLD = 3; // allow 3px of movement

// State for when pen is being used
export class PenDrawingState extends StateNode {
  static override id = 'pen_drawing';

  private _startInfo: ToolPointerDownInfo = { point: { x: 0, y: 0, z: 0.5 } };
  private _target: DrawShape | undefined;
  private _isPenDevice = false;
  private _hasPressure = false;
  private _phase: StrokePhase = 'free';
  private _extending = false;
  private _anchor: Vec3 = { x: 0, y: 0 };
  private _pendingAnchor: Vec3 | null = null;
  private _lastSample: Vec3 = { x: 0, y: 0 };
  private _shouldMerge = false;
  private _pathLen = 0;
  private _activePts: Vec3[] = [];

  private _pointTimestamps: number[] = [];
  private _dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private _dwellAnchor: Vec3 = { x: 0, y: 0 };
  private _closureLocked = false;

  override onEnter(info?: ToolPointerDownInfo): void {
    this._startInfo = info ?? { point: { x: 0, y: 0, z: 0.5 } };
    this._lastSample = { ...this.editor.input.getCurrentPagePoint() };
    this._dwellAnchor = { ...this._lastSample };
    this.editor.beginHistoryEntry();
    this.beginStroke();
    this.resetDwellTimer();
  }

  override onPointerMove(): void {
    const inputs = this.editor.input;
    const penActive = inputs.getIsPen();
    if (this._isPenDevice && !penActive) {
      this.beginStroke();
      return;
    }
    if (this._hasPressure) {
      const cur = inputs.getCurrentPagePoint();
      const threshold = 1 / this.editor.getZoomLevel();
      if (dist(cur, this._lastSample) >= threshold) {
        this._lastSample = { ...cur };
        this._shouldMerge = false;
      } else {
        this._shouldMerge = true;
      }
    } else {
      this._shouldMerge = false;
    }
    this.advanceStroke();
    this.trackDwell();
  }

  // Shift: start a new straight segment
  // Maybe add a specific key for snapping or turning drawing into a proper shape?

  override onKeyDown(info?: ToolKeyInfo): void {
    if (info?.key === 'Shift') {
      switch (this._phase) {
        case 'free':
          this._phase = 'starting_straight';
          this._pendingAnchor = { ...this.editor.input.getCurrentPagePoint() };
          break;
        case 'starting_free':
          this._phase = 'starting_straight';
          break;
      }
    }
    this.advanceStroke();
  }

  override onKeyUp(info?: ToolKeyInfo): void {
    if (info?.key === 'Shift') {
      switch (this._phase) {
        case 'straight':
          this._phase = 'starting_free';
          this._pendingAnchor = { ...this.editor.input.getCurrentPagePoint() };
          break;
        case 'starting_straight':
          this._pendingAnchor = null;
          this._phase = 'free';
          break;
      }
    }
    this.advanceStroke();
  }

  override onPointerUp(): void {
    this.clearDwellTimer();
    this.endStroke();
  }

  override onExit(): void {
    this.clearDwellTimer();
  }

  override onCancel(): void {
    this.clearDwellTimer();
    this.editor.endHistoryEntry();
    this.ctx.transition('pen_idle', this._startInfo);
  }

  override onInterrupt(): void {
    this.clearDwellTimer();
    if (!this.editor.input.getIsDragging()) {
      this.editor.endHistoryEntry();
      this.ctx.transition('pen_idle', this._startInfo);
    }
  }

  private detectClosure(
    segments: DrawSegment[],
    size: DrawShape['props']['size'],
    scale: number
  ): boolean {
    if (segments.length === 0) return false;
    const w = STROKE_WIDTHS[size];
    const first = decodeFirstPoint(segments[0]!.path);
    const lastSeg = segments[segments.length - 1];
    const end = decodeLastPoint(lastSeg!.path);
    if (!first || !end) return false;
    if (this._pathLen <= w * 4 * scale) return false;
    const eps = 1e-6;
    if (Math.abs(first.x - end.x) < eps && Math.abs(first.y - end.y) < eps) return true;
    return withinRadius(first, end, CLOSURE_VERTEX_SNAP_PX * scale);
  }

  private checkClosure(segments: DrawSegment[], size: DrawShape['props']['size'], scale: number): boolean {
    if (this._closureLocked) return true;
    if (this.detectClosure(segments, size, scale)) {
      this._closureLocked = true;
      return true;
    }
    return false;
  }

  private measurePath(segments: DrawSegment[]): number {
    let sum = 0;
    for (const seg of segments) {
      const pts = decodePoints(seg.path);
      for (let i = 0; i < pts.length - 1; i++) {
        sum += sqDist(pts[i]!, pts[i + 1]!);
      }
    }
    return Math.sqrt(sum);
  }

  // Start a new shape, when user starts a stroke
  private beginStroke(): void {
    const inputs = this.editor.input;
    const origin = inputs.getOriginPagePoint();
    const penActive = inputs.getIsPen();
    const z = this._startInfo?.point?.z ?? 0.5;
    this._isPenDevice = penActive;
    this._hasPressure = penActive || z !== 0.5;
    const pressure = this._hasPressure ? z * 1.25 : 0.5;
    this._phase = inputs.getShiftKey() ? 'straight' : 'free';
    this._extending = false;
    this._lastSample = { ...origin };

    const sorted = this.editor.store.getCurrentPageShapesSorted();
    const prev = tail(sorted) as DrawShape | undefined;
    const existing = prev?.type === 'draw' ? prev : undefined;
    this._target = existing;

    if (existing && this._phase === 'straight') {
      const prevSeg = tail(existing.props.segments);
      if (!prevSeg) { this.spawnShape(origin, pressure); return; }
      const prevEnd = decodeLastPoint(prevSeg.path);
      if (!prevEnd) { this.spawnShape(origin, pressure); return; }
      this._extending = true;
      this._closureLocked = false;
      const local = this.editor.getPointInShapeSpace(existing, origin);
      const localPt: Vec3 = { x: local.x, y: local.y, z: pressure };
      const newSeg: DrawSegment = {
        type: 'straight',
        path: encodePoints([
          { x: prevEnd.x, y: prevEnd.y, z: pressure },
          localPt,
        ]),
      };
      this._anchor = {
        x: existing.x + prevEnd.x,
        y: existing.y + prevEnd.y,
      };
      this._pendingAnchor = null;
      const segs = [...existing.props.segments, newSeg];
      this._pathLen = this.measurePath(segs);
      this.editor.updateShapes([
        {
          id: existing.id,
          type: 'draw',
          props: {
            segments: segs,
              isClosed: this.checkClosure(segs, existing.props.size, existing.props.scale),
          },
        },
      ]);
      return;
    }

    // If the previous shape ends near the current origin and is freehand, continue it instead of making a new shape.
    // This allows the entire stroke to be in one shape so shapes that were somehow broken can be recognized as one.
    // This fixes the autoshape issue where autoshape only works on a bit of a shape (due to other bits breaking off).
    if (existing && existing.props.segments.some((s) => s.type === 'free')) {
      const prevSeg = tail(existing.props.segments);
      if (prevSeg) {
        const prevEnd = decodeLastPoint(prevSeg.path);
        if (prevEnd) {
          const prevEndPage: Vec3 = { x: existing.x + prevEnd.x, y: existing.y + prevEnd.y };
          const snapDist = CLOSURE_VERTEX_SNAP_PX / this.editor.getZoomLevel();
          if (withinRadius(origin, prevEndPage, snapDist)) {
            this._closureLocked = false;
            const local = this.editor.getPointInShapeSpace(existing, origin);
            const localPt: Vec3 = { x: local.x, y: local.y, z: pressure };
            this._activePts = [localPt];
            this._pointTimestamps = [performance.now()];
            const newSeg: DrawSegment = { type: 'free', path: encodePoints([localPt]) };
            const segs = [...existing.props.segments, newSeg];
            this._pathLen = this.measurePath(segs);
            this.editor.updateShapes([{
              id: existing.id,
              type: 'draw',
              props: {
                segments: segs,
                isComplete: false,
                isClosed: this.checkClosure(segs, existing.props.size, existing.props.scale),
              },
            }]);
            return;
          }
        }
      }
    }

    this.spawnShape(origin, pressure);
  }

  // Create a new shape, when we need a new drawing shape 
  private spawnShape(originPt: Vec3, pressure: number): void {
    const origin = originPt;
    this._anchor = { ...origin };
    this._closureLocked = false;
    const drawStyle = this.editor.getCurrentDrawStyle();
    const id = this.editor.createShapeId();
    const firstPt: Vec3 = { x: 0, y: 0, z: pressure };
    this._activePts = [firstPt];
    this._pointTimestamps = [performance.now()];
    this.editor.createShape({
      id,
      type: 'draw',
      x: origin.x,
      y: origin.y,
      props: {
        color: drawStyle.color,
        dash: drawStyle.dash,
        size: drawStyle.size,
        scale: 1,
        isPen: this._hasPressure,
        isComplete: false,
        segments: [
          {
            type: this._phase === 'straight' ? 'straight' : 'free',
            path: encodePoints([firstPt]),
          },
        ],
      },
    });
    const shape = this.editor.getShape(id) as DrawShape | undefined;
    if (!shape) {
      this.ctx.transition('pen_idle', this._startInfo);
      return;
    }
    this._pathLen = 0;
    this._target = shape;
  }

  // Update the drawing shape, while user is drawing
  private advanceStroke(): void {
    const target = this._target;
    const inputs = this.editor.input;
    if (!target) return;

    const shape = this.editor.getShape(target.id) as DrawShape | undefined;
    if (!shape) return;

    const { id, props: { size, scale } } = target;
    const { segments } = shape.props;
    const curPt = inputs.getCurrentPagePoint();

    if (!this._hasPressure) {
      const liveZ = curPt.z ?? 0.5;
      if ((liveZ > 0 && liveZ !== 0.5) || inputs.getIsPen()) {
        this._hasPressure = true;
      }
    }

    const local = this.editor.getPointInShapeSpace(shape, curPt);
    const pressure = this._hasPressure
      ? (curPt.z ?? 0.5) * 1.25
      : 0.5;
    const pt: Vec3 = { x: local.x, y: local.y, z: pressure };

    // Straight: straight lines, eg. holding shift
    // Free: smooth drawings so drawings doesnt look geometrical

    switch (this._phase) {
      case 'starting_straight': {
        const pending = this._pendingAnchor;
        if (!pending) break;
        if (sqDist(pending, inputs.getCurrentPagePoint()) <= this.editor.options.dragDistanceSquared) break;
        this._anchor = { ...pending };
        this._pendingAnchor = null;
        this._phase = 'straight';
        const prevSeg = tail(segments);
        if (!prevSeg) break;
        const prevEnd = decodeLastPoint(prevSeg.path);
        if (!prevEnd) break;
        const anchorLocal = this.editor.getPointInShapeSpace(shape, this._anchor);
        const anchorPt = anchorLocal;
        const seg: DrawSegment = {
          type: 'straight',
          path: encodePoints([prevEnd, { ...anchorPt, z: pressure }]),
        };
        const withStraightSeg = [...segments, seg];
        this.editor.updateShapes([
          {
            id,
            type: 'draw',
            props: {
              segments: withStraightSeg,
              isClosed: this.checkClosure(withStraightSeg, size, scale),
            },
          },
        ]);
        break;
      }
      case 'starting_free': {
        const pending = this._pendingAnchor;
        if (!pending) break;
        if (sqDist(pending, inputs.getCurrentPagePoint()) <= this.editor.options.dragDistanceSquared) break;
        this._anchor = { ...pending };
        this._pendingAnchor = null;
        this._phase = 'free';
        const prevSeg = tail(segments);
        if (!prevSeg) break;
        const prevEnd = decodeLastPoint(prevSeg.path);
        if (!prevEnd) break;
        const interpolated = lerpPath(prevEnd, pt, 6);
        this._activePts = interpolated;
        const freeSeg: DrawSegment = {
          type: 'free',
          path: encodePoints(interpolated),
        };
        const allSegs = [...segments, freeSeg];
        this._pathLen = this.measurePath(allSegs);
        this.editor.updateShapes([
          {
            id,
            type: 'draw',
            props: {
              segments: allSegs,
              isClosed: this.checkClosure(allSegs, size, scale),
            },
          },
        ]);
        break;
      }
      case 'straight': {
        const updated = segments.slice();
        const lastSeg = updated[updated.length - 1];
        if (!lastSeg) break;
        const anchorPage = this._anchor;
        const current = inputs.getCurrentPagePoint();
        const shouldSnap = !this._extending || inputs.getIsDragging();
        if (this._extending && inputs.getIsDragging()) {
          this._extending = false;
        }
        let pagePt: Vec3;
        if (shouldSnap) {
          const angle = Math.atan2(
            current.y - anchorPage.y,
            current.x - anchorPage.x
          );
          const snapped = quantizeAngle(angle, 24);
          const diff = snapped - angle;
          pagePt = rotateAround(current, anchorPage, diff);
        } else {
          pagePt = { ...current };
        }
        const localPt = this.editor.getPointInShapeSpace(shape, pagePt);
        const fixedPt = localPt;
        const segStart = decodeFirstPoint(lastSeg.path);
        if (segStart) {
          this._pathLen += dist(segStart, fixedPt);
        }
        updated[updated.length - 1] = {
          ...lastSeg,
          type: 'straight',
          path: encodePoints([segStart ?? fixedPt, { ...fixedPt, z: pressure }]),
        };
        this.editor.updateShapes([
          {
            id,
            type: 'draw',
            props: {
              segments: updated,
              isClosed: this.checkClosure(updated, size, scale),
            },
          },
        ]);
        break;
      }
      case 'free': {
        const cached = this._activePts;
        if (cached.length && this._shouldMerge) {
          const last = cached[cached.length - 1]!;
          last.x = pt.x;
          last.y = pt.y;
          last.z = last.z != null ? Math.max(last.z, pt.z ?? 0) : pt.z;
        } else {
          this._pathLen += cached.length
            ? dist(cached[cached.length - 1]!, pt)
            : 0;
          cached.push({ x: pt.x, y: pt.y, z: pt.z });
          this._pointTimestamps.push(performance.now());
        }
        const updated = segments.slice();
        const lastSeg = updated[updated.length - 1]!;
        updated[updated.length - 1] = {
          ...lastSeg,
          path: encodePoints(cached),
        };
        if (this._pathLen < STROKE_WIDTHS[shape.props.size] * 4) {
          this._pathLen = this.measurePath(updated);
        }
        this.editor.updateShapes([
          {
            id,
            type: 'draw',
            props: {
              segments: updated,
              isClosed: this.checkClosure(updated, size, scale),
            },
          },
        ]);
        if (cached.length > MAX_POINTS_PER_SHAPE) {
          // Cap the current segment and start a new one in the SAME shape so full stroke stays together for autoshape.
          const curPage = inputs.getCurrentPagePoint();
          const local = this.editor.getPointInShapeSpace(shape, curPage);
          const firstPt: Vec3 = {
            x: local.x,
            y: local.y,
            z: this._hasPressure ? (curPage.z ?? 0.5) * 1.25 : 0.5,
          };
          this._activePts = [firstPt];
          this._pointTimestamps = [performance.now()];
          const newSeg: DrawSegment = { type: 'free', path: encodePoints([firstPt]) };
          const withNewSeg = [...updated, newSeg];
          this._pathLen = this.measurePath(withNewSeg);
          this.editor.updateShapes([{
            id,
            type: 'draw',
            props: { segments: withNewSeg },
          }]);
        }
        break;
      }
    }
  }

  private endStroke(): void {
    if (!this._target) return;
    this.editor.updateShapes([
      { id: this._target.id, type: 'draw', props: { isComplete: true, isPen: this._hasPressure } },
    ]);
    this.editor.endHistoryEntry();
    this.ctx.transition('pen_idle');
  }

  private trackDwell(): void {
    const currentPage = this.editor.input.getCurrentPagePoint();
    const moveThreshold = DWELL_MOVE_THRESHOLD / this.editor.getZoomLevel();
    const moved = dist(currentPage, this._dwellAnchor) > moveThreshold;

    if (moved) {
      this._dwellAnchor = { ...currentPage };
      this.resetDwellTimer();
    }
  }

  private resetDwellTimer(): void {
    if (this.editor.autoShape?.enabled === false) return;
    this.clearDwellTimer();
    this._dwellTimer = setTimeout(() => {
      this._dwellTimer = null;
      this.attemptShapeRecognition();
    }, DWELL_TIMEOUT_MS);
  }

  private clearDwellTimer(): void {
    if (this._dwellTimer !== null) {
      clearTimeout(this._dwellTimer);
      this._dwellTimer = null;
    }
  }

  private attemptShapeRecognition(): void {
    const target = this._target;
    if (!target) return;

    const shape = this.editor.getShape(target.id) as DrawShape | undefined;
    if (!shape) return;

    // Get points from all segments so autoshape sees the full stroke even when multiple broken segments exist (merged strokes, mode switches, etc.)
    const pagePoints: Vec3[] = [];
    for (const seg of shape.props.segments) {
      const pts = decodePoints(seg.path);
      for (const p of pts) {
        pagePoints.push({ x: p.x + shape.x, y: p.y + shape.y, z: p.z });
      }
    }
    if (pagePoints.length < 3) return;

    // Timestamps are only reliable when shape has a single free segment which's points exactly match _activePts. otherwise skip them
    const timestamps =
      shape.props.segments.length === 1 &&
      this._pointTimestamps.length === pagePoints.length
        ? this._pointTimestamps
        : undefined;

    const recognized = recognizeShape(pagePoints, timestamps, this.editor.autoShape);
    if (!recognized) return;

    this.applyRecognizedShape(shape, recognized);
  }

  private applyRecognizedShape(shape: DrawShape, recognized: RecognizedShape): void {
    if (recognized.kind === 'polyline') {
      const bb = boundingBox(recognized.vertices);
      const localVerts = recognized.vertices.map((v) => ({
        x: v.x - bb.x,
        y: v.y - bb.y,
        z: v.z,
      }));
      this.editor.store.updateShape(shape.id, {
        x: bb.x,
        y: bb.y,
        props: {
          ...shape.props,
          segments: buildPolylineSegments(localVerts, recognized.closed),
          isClosed: recognized.closed,
          isComplete: true,
        },
      });
    } else {
      const shapeX = recognized.cx - recognized.width / 2;
      const shapeY = recognized.cy - recognized.height / 2;
      this.editor.store.updateShape(shape.id, {
        x: shapeX,
        y: shapeY,
        props: {
          ...shape.props,
          segments: buildEllipseSegments(recognized.width, recognized.height),
          isClosed: true,
          isComplete: true,
        },
      });
    }

    this.editor.requestRender();

    const recognitionInfo: RecognitionEntryInfo = {
      shapeId: shape.id,
      recognized,
    };

    this.ctx.transition('pen_recognizing', recognitionInfo as any);
  }
}
