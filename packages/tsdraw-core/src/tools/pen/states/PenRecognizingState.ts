import { StateNode, type ToolKeyInfo, type ToolStateTransitionInfo } from '../../../store/stateNode.js';
import type { DrawShape, Vec3, ShapeId } from '../../../types.js';
import type { RecognizedShape, RecognitionEntryInfo } from '../../../utils/shapeRecognition.js';
export type { RecognitionEntryInfo } from '../../../utils/shapeRecognition.js';
import { boundingBox, nearestPointIndex, snapToNearestNode } from '../../../utils/vec.js';
import { buildPolylineSegments, buildEllipseSegments } from '../../geometric/geometricShapeHelpers.js';

const NODE_SNAP_RADIUS_PX = 20;

// Active after shape recognition snaps a freehand stroke to a geometric shape.
// The active vertex follows the mouse cursor while others are fixed.
// For rectangles, moving one corner keeps the shape rectangular (like on Goodnotes)
export class PenRecognizingState extends StateNode {
  static override id = 'pen_recognizing';

  private shapeId: ShapeId = '';
  private recognized: RecognizedShape | null = null;

  private polyVertices: Vec3[] = [];
  private polyClosed = false;
  private activeIdx = -1;
  private rectAnchorIdx = -1;

  private ellipseCenter: Vec3 = { x: 0, y: 0 };
  override onEnter(info?: ToolStateTransitionInfo): void {
    const entry = info as unknown as RecognitionEntryInfo | undefined;
    if (!entry) {
      this.ctx.transition('pen_idle'); // missing transition payload
      return;
    }
    this.shapeId = entry.shapeId;
    this.recognized = entry.recognized;

    if (entry.recognized.kind === 'polyline') { // open/closed polyline. rect uses rectangleAnchorIdx
      this.polyVertices = entry.recognized.vertices.map((v) => ({ ...v }));
      this.polyClosed = entry.recognized.closed;
      this.activeIdx = entry.recognized.activeVertexIdx;
      this.rectAnchorIdx = entry.recognized.rectangleAnchorIdx ?? -1;
    } else {
      this.ellipseCenter = { // fixed center for ellipses but might change
        x: entry.recognized.cx,
        y: entry.recognized.cy,
      };
    }
  }

  override onPointerMove(): void {
    if (!this.recognized) return;
    const cursorPage = this.editor.input.getCurrentPagePoint();

    if (this.recognized.kind === 'polyline') {
      if (this.rectAnchorIdx >= 0) { // rect uses rectangleAnchorIdx
        this.resizeRectangle(cursorPage);
      } else {
        this.resizePolyline(cursorPage);
      }
    } else {
      this.resizeEllipse(cursorPage);
    }
  }

  override onPointerUp(): void {
    this.finalizeShape();
  }

  override onKeyDown(_info?: ToolKeyInfo): void {
    this.onPointerMove();
  }

  override onKeyUp(_info?: ToolKeyInfo): void {
    this.onPointerMove();
  }

  override onCancel(): void {
    this.editor.endHistoryEntry();
    this.ctx.transition('pen_idle');
  }

  override onInterrupt(): void {
    this.finalizeShape();
  }

  private finalizeShape(): void {
    const shape = this.editor.getShape(this.shapeId) as DrawShape | undefined;
    if (shape) {
      this.editor.updateShapes([
        { id: this.shapeId, type: 'draw', props: { isComplete: true } },
      ]);
    }
    this.recognized = null;
    this.editor.endHistoryEntry();
    this.ctx.transition('pen_idle');
  }

  // Other shape nodes plus this ones's (except dragged node itself)
  private snapCandidates(excludeVertexIndex: number): Vec3[] {
    const onThisShape = this.polyVertices
      .filter((_, i) => i !== excludeVertexIndex)
      .map((v) => ({ x: v.x, y: v.y, z: v.z ?? 0.5 }));
    return [...onThisShape, ...this.editor.getShapeNodes(this.shapeId)];
  }

  private resizePolyline(cursorPage: Vec3): void {
    const existingProps = this.getActiveProps();
    if (!existingProps) return;
    if (this.activeIdx < 0 || this.activeIdx >= this.polyVertices.length) return;

    const snapRadius = NODE_SNAP_RADIUS_PX / this.editor.getZoomLevel();
    const nodes = this.snapCandidates(this.activeIdx);
    const target = snapToNearestNode(cursorPage, nodes, snapRadius) ?? { x: cursorPage.x, y: cursorPage.y, z: 0.5 };
    this.polyVertices[this.activeIdx] = target;

    this.applyPolylineToShape(existingProps);
  }

  // For rectangles, moving one corner keeps the shape rectangular
  // The diagonally opposite anchor point stays fixed
  private resizeRectangle(cursorPage: Vec3): void {
    const existingProps = this.getActiveProps();
    if (!existingProps) return;
    if (this.rectAnchorIdx < 0 || this.rectAnchorIdx >= this.polyVertices.length) return;

    const draggedIdx = nearestPointIndex(this.polyVertices, cursorPage);
    const snapRadius = NODE_SNAP_RADIUS_PX / this.editor.getZoomLevel();
    const nodes = this.snapCandidates(draggedIdx);
    const effectiveCursor = snapToNearestNode(cursorPage, nodes, snapRadius) ?? cursorPage;

    const anchor = this.polyVertices[this.rectAnchorIdx]!;
    const minX = Math.min(anchor.x, effectiveCursor.x);
    const minY = Math.min(anchor.y, effectiveCursor.y);
    const maxX = Math.max(anchor.x, effectiveCursor.x);
    const maxY = Math.max(anchor.y, effectiveCursor.y);

    this.polyVertices = [
      { x: minX, y: minY, z: 0.5 },
      { x: maxX, y: minY, z: 0.5 },
      { x: maxX, y: maxY, z: 0.5 },
      { x: minX, y: maxY, z: 0.5 },
    ];

    const cursorIdx = nearestPointIndex(this.polyVertices, cursorPage);
    this.activeIdx = cursorIdx;
    this.rectAnchorIdx = (cursorIdx + 2) % 4;

    this.applyPolylineToShape(existingProps);
  }

  // For ellipses, the center point stays fixed
  private resizeEllipse(cursorPage: Vec3): void {
    const existingProps = this.getActiveProps();
    if (!existingProps) return;

    const halfW = Math.max(Math.abs(cursorPage.x - this.ellipseCenter.x), 1);
    const halfH = Math.max(Math.abs(cursorPage.y - this.ellipseCenter.y), 1);
    const w = halfW * 2;
    const h = halfH * 2;

    this.editor.store.updateShape(this.shapeId, {
      x: this.ellipseCenter.x - halfW,
      y: this.ellipseCenter.y - halfH,
      props: {
        ...existingProps,
        segments: buildEllipseSegments(w, h),
        isClosed: true,
        isComplete: true,
      },
    });
  }

  private applyPolylineToShape(existingProps: DrawShape['props']): void {
    const bb = boundingBox(this.polyVertices);
    const localVerts = this.polyVertices.map((v) => ({
      x: v.x - bb.x,
      y: v.y - bb.y,
      z: v.z,
    }));

    this.editor.store.updateShape(this.shapeId, {
      x: bb.x,
      y: bb.y,
      props: {
        ...existingProps,
        segments: buildPolylineSegments(localVerts, this.polyClosed),
        isClosed: this.polyClosed,
        isComplete: true,
      },
    });
  }

  private getActiveProps(): DrawShape['props'] | null {
    const shape = this.editor.getShape(this.shapeId) as DrawShape | undefined;
    return shape?.props ?? null;
  }
}
