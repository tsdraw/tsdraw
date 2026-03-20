import {
  StateNode,
  type ToolKeyInfo,
  type ToolPointerDownInfo,
} from '../../../store/stateNode.js';
import type { DrawShape, DrawSegment, Vec3 } from '../../../types.js';
import { STROKE_WIDTHS, MAX_POINTS_PER_SHAPE } from '../../../types.js';
import { encodePoints, decodePoints, decodeFirstPoint, decodeLastPoint } from '../../../utils/pathCodec.js';
import { dist, sqDist, withinRadius, toFixed, roundPt, lerpPath, tail, quantizeAngle, rotateAround } from '../../../utils/vec.js';

type StrokePhase = 'free' | 'straight' | 'starting_straight' | 'starting_free';

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

  override onEnter(info?: ToolPointerDownInfo): void {
    this._startInfo = info ?? { point: { x: 0, y: 0, z: 0.5 } };
    this._lastSample = { ...this.editor.input.getCurrentPagePoint() };
    this.beginStroke();
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
    this.endStroke();
  }

  override onCancel(): void {
    this.ctx.transition('pen_idle', this._startInfo);
  }

  override onInterrupt(): void {
    if (!this.editor.input.getIsDragging()) {
      this.ctx.transition('pen_idle', this._startInfo);
    }
  }

  private canClosePath(): boolean {
    return true;
  }

  private detectClosure(
    segments: DrawSegment[],
    size: DrawShape['props']['size'],
    scale: number
  ): boolean {
    if (!this.canClosePath() || segments.length === 0) return false;
    const w = STROKE_WIDTHS[size];
    const first = decodeFirstPoint(segments[0]!.path);
    const lastSeg = segments[segments.length - 1];
    const end = decodeLastPoint(lastSeg!.path);
    if (!first || !end) return false;
    if (first.x === end.x && first.y === end.y) return false;
    if (this._pathLen <= w * 4 * scale) return false;
    return withinRadius(first, end, w * 2 * scale);
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
    const pressure = this._hasPressure ? toFixed(z) : 0.5;
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
      const local = this.editor.getPointInShapeSpace(existing, origin);
      const localPt: Vec3 = { x: toFixed(local.x), y: toFixed(local.y), z: pressure };
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
            isClosed: this.detectClosure(segs, existing.props.size, existing.props.scale),
          },
        },
      ]);
      return;
    }

    this.spawnShape(origin, pressure);
  }

  // Create a new shape, when we need a new drawing shape 
  private spawnShape(originPt: Vec3, pressure: number): void {
    this._anchor = { ...originPt };
    const drawStyle = this.editor.getCurrentDrawStyle();
    const id = this.editor.createShapeId();
    const firstPt: Vec3 = { x: 0, y: 0, z: pressure };
    this._activePts = [firstPt];
    this.editor.createShape({
      id,
      type: 'draw',
      x: originPt.x,
      y: originPt.y,
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
      if (liveZ !== 0.5 || inputs.getIsPen()) {
        this._hasPressure = true;
        this.editor.updateShapes([{ id, type: 'draw', props: { isPen: true } }]);
      }
    }

    const local = this.editor.getPointInShapeSpace(shape, curPt);
    const pressure = this._hasPressure
      ? toFixed(curPt.z ?? 0.5)
      : 0.5;
    const pt: Vec3 = { x: toFixed(local.x), y: toFixed(local.y), z: pressure };

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
        const anchorPt = roundPt(anchorLocal);
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
              isClosed: this.detectClosure(withStraightSeg, size, scale),
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
              isClosed: this.detectClosure(allSegs, size, scale),
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
        const fixedPt = roundPt(localPt);
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
              isClosed: this.detectClosure(updated, size, scale),
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
              isClosed: this.detectClosure(updated, size, scale),
            },
          },
        ]);
        if (cached.length > MAX_POINTS_PER_SHAPE) {
          this.editor.updateShapes([{ id, type: 'draw', props: { isComplete: true } }]);
          const newId = this.editor.createShapeId();
          const curPage = inputs.getCurrentPagePoint();
          const firstPt: Vec3 = {
            x: 0,
            y: 0,
            z: this._hasPressure ? toFixed(curPage.z ?? 0.5) : 0.5,
          };
          this._activePts = [firstPt];
          this.editor.createShape({
            id: newId,
            type: 'draw',
            x: curPage.x,
            y: curPage.y,
            props: {
              color: shape.props.color,
              dash: shape.props.dash,
              size: shape.props.size,
              scale: shape.props.scale,
              isPen: this._hasPressure,
              isComplete: false,
              segments: [{ type: 'free', path: encodePoints([firstPt]) }],
            },
          });
          const created = this.editor.getShape(newId) as DrawShape | undefined;
          if (created) {
            this._target = created;
            this._lastSample = { ...curPage };
            this._pathLen = 0;
          }
        }
        break;
      }
    }
  }

  private endStroke(): void {
    if (!this._target) return;
    this.editor.updateShapes([
      { id: this._target.id, type: 'draw', props: { isComplete: true } },
    ]);
    this.ctx.transition('pen_idle');
  }
}
