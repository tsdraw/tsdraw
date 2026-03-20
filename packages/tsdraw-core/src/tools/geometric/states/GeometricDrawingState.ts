import { StateNode, type ToolPointerDownInfo } from '../../../store/stateNode.js';
import type { DrawSegment, DrawShape, ShapeId } from '../../../types.js';
import type { ShapeBounds } from '../geometricShapeHelpers.js';

interface GeometricDrawingStateConfig {
  idleStateId: string;
  buildConstrainedBounds: (
    anchorX: number,
    anchorY: number,
    cursorX: number,
    cursorY: number
  ) => ShapeBounds;
  buildUnconstrainedBounds: (
    anchorX: number,
    anchorY: number,
    cursorX: number,
    cursorY: number
  ) => ShapeBounds;
  buildSegments: (width: number, height: number) => DrawSegment[];
}

// Abstract base for geometric shape drawing states
// Subclasses just provide a config with bound-builders and segment-builders
// All pointer tracking, shape creation, and completion logic is here
export abstract class GeometricDrawingState extends StateNode {
  private currentShapeId: ShapeId | null = null;
  private startedAt: ToolPointerDownInfo = { point: { x: 0, y: 0, z: 0.5 } };

  protected abstract getConfig(): GeometricDrawingStateConfig;

  override onEnter(info?: ToolPointerDownInfo): void {
    this.startedAt = info ?? { point: { x: 0, y: 0, z: 0.5 } };
    const originPoint = this.editor.input.getOriginPagePoint();
    const drawStyle = this.editor.getCurrentDrawStyle();
    const nextShapeId = this.editor.createShapeId();
    const config = this.getConfig();

    this.editor.createShape({
      id: nextShapeId,
      type: 'draw',
      x: originPoint.x,
      y: originPoint.y,
      props: {
        color: drawStyle.color,
        dash: drawStyle.dash,
        fill: drawStyle.fill,
        size: drawStyle.size,
        scale: 1,
        isPen: false,
        isComplete: false,
        isClosed: true,
        segments: config.buildSegments(1, 1),
      },
    });

    this.currentShapeId = nextShapeId;
  }

  // Shift key switches between constrained and unconstrained bounds
  override onPointerMove(): void {
    const activeShape = this.getActiveShape();
    if (!activeShape) return;
    const config = this.getConfig();
    const originPoint = this.editor.input.getOriginPagePoint();
    const cursorPoint = this.editor.input.getCurrentPagePoint();
    const shapeBounds = this.editor.input.getShiftKey()
      ? config.buildConstrainedBounds(originPoint.x, originPoint.y, cursorPoint.x, cursorPoint.y)
      : config.buildUnconstrainedBounds(originPoint.x, originPoint.y, cursorPoint.x, cursorPoint.y);

    this.editor.store.updateShape(activeShape.id, {
      x: shapeBounds.x,
      y: shapeBounds.y,
      props: {
        ...activeShape.props,
        segments: config.buildSegments(shapeBounds.width, shapeBounds.height),
        isClosed: true,
      },
    });
  }

  override onPointerUp(): void {
    this.completeShape();
  }

  override onCancel(): void {
    this.removeCurrentShape();
    this.ctx.transition(this.getConfig().idleStateId, this.startedAt);
  }

  override onInterrupt(): void {
    this.completeShape();
  }

  override onKeyDown(): void {
    this.onPointerMove();
  }

  override onKeyUp(): void {
    this.onPointerMove();
  }

  // If user dragged, use the drag extents for the final shape
  // If they just clicked without dragging, use default-sized shape
  // If they dragged just a bit (most likely a click), remove the shape and go back to idle
  private completeShape(): void {
    const activeShape = this.getActiveShape();
    const config = this.getConfig();
    if (!activeShape) {
      this.ctx.transition(config.idleStateId, this.startedAt);
      return;
    }

    const originPoint = this.editor.input.getOriginPagePoint();
    const cursorPoint = this.editor.input.getCurrentPagePoint();
    const dx = cursorPoint.x - originPoint.x;
    const dy = cursorPoint.y - originPoint.y;
    const draggedFarEnough = (dx * dx + dy * dy) > this.editor.options.dragDistanceSquared;

    if (!draggedFarEnough) {
      this.removeCurrentShape();
      this.ctx.transition(config.idleStateId, this.startedAt);
      return;
    }
    const finalizedBounds = this.editor.input.getShiftKey()
      ? config.buildConstrainedBounds(originPoint.x, originPoint.y, cursorPoint.x, cursorPoint.y)
      : config.buildUnconstrainedBounds(originPoint.x, originPoint.y, cursorPoint.x, cursorPoint.y);

    this.editor.store.updateShape(activeShape.id, {
      x: finalizedBounds.x,
      y: finalizedBounds.y,
      props: {
        ...activeShape.props,
        fill: this.editor.getCurrentDrawStyle().fill,
        isComplete: true,
        isClosed: true,
        segments: config.buildSegments(finalizedBounds.width, finalizedBounds.height),
      },
    });

    this.currentShapeId = null;
    this.ctx.transition(config.idleStateId);
  }

  private removeCurrentShape(): void {
    if (!this.currentShapeId) return;
    this.editor.store.deleteShapes([this.currentShapeId]);
    this.currentShapeId = null;
  }

  private getActiveShape(): DrawShape | null {
    if (!this.currentShapeId) return null;
    const shape = this.editor.getShape(this.currentShapeId);
    if (!shape || shape.type !== 'draw') return null;
    return shape;
  }
}
