import {
  StateNode,
  type ToolPointerMoveInfo,
  type ToolStateTransitionInfo,
} from '../../../store/stateNode.js';
import type { DrawShape } from '../../../types.js';
import type { ShapeId } from '../../../types.js';
import { pointHitsShape, ERASER_MARGIN } from '../eraserHitTest.js';

// State for when eraser is being pressed but not dragged
export class EraserPointingState extends StateNode {
  static override id = 'eraser_pointing';

  override onEnter(_info?: ToolStateTransitionInfo): void {
    const zoom = this.editor.getZoomLevel();
    const tolerance = ERASER_MARGIN / zoom;
    const pt = this.editor.input.getCurrentPagePoint();
    const allShapes = this.editor.store.getCurrentPageRenderingShapesSorted();
    const hits: ShapeId[] = [];

    for (const shape of allShapes) {
      if (shape.type !== 'draw') continue;
      if (pointHitsShape(shape as DrawShape, pt.x, pt.y, tolerance)) {
        hits.push(shape.id);
      }
    }
    this.editor.setErasingShapes(hits);
  }

  override onPointerMove(info?: ToolPointerMoveInfo): void {
    if (this.editor.input.getIsDragging()) {
      this.ctx.transition('eraser_erasing', info);
    }
  }

  override onPointerUp(): void {
    this.finish();
  }

  override onExit(_info?: ToolStateTransitionInfo, to?: string): void {
    if (to !== 'eraser_erasing') {
      this.editor.setErasingShapes([]);
    }
  }

  override onCancel(): void {
    this.editor.setErasingShapes([]);
    this.ctx.transition('eraser_idle');
  }

  private finish(): void {
    const ids = this.editor.getErasingShapeIds();
    if (ids.length > 0) {
      this.editor.store.deleteShapes(ids);
      this.editor.setErasingShapes([]);
    }
    this.ctx.transition('eraser_idle');
  }
}
