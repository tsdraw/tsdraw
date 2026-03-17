import { StateNode, type ToolStateTransitionInfo } from '../../../store/stateNode.js';
import type { DrawShape } from '../../../types.js';
import type { ShapeId } from '../../../types.js';
import { segmentHitsShape, boundsOf, padBounds, ERASER_MARGIN } from '../eraserHitTest.js';

// State for when eraser is being used
export class EraserErasingState extends StateNode {
  static override id = 'eraser_erasing';

  private _marked: ShapeId[] = [];

  override onEnter(_info?: ToolStateTransitionInfo): void {
    this._marked = [...this.editor.getErasingShapeIds()];
    this.sweep();
  }

  override onPointerMove(): void { this.sweep(); }
  override onPointerUp(): void { this.finish(); }

  override onExit(): void { this.editor.setErasingShapes([]); }
  override onCancel(): void { this.ctx.transition('eraser_idle'); }

  private sweep(): void {
    const zoom = this.editor.getZoomLevel();
    const tolerance = ERASER_MARGIN / zoom;
    const cur = this.editor.input.getCurrentPagePoint();
    const prev = this.editor.input.getPreviousPagePoint();
    const hitIds = new Set<ShapeId>(this.editor.getErasingShapeIds());

    const sweepArea = padBounds(boundsOf([prev, cur]), tolerance);
    const nearby = this.editor.store.getShapeIdsInBounds(sweepArea);
    const candidates = this.editor.store
      .getCurrentPageRenderingShapesSorted()
      .filter((s) => nearby.has(s.id));

    for (const shape of candidates) {
      if (shape.type !== 'draw') continue;
      if (segmentHitsShape(shape as DrawShape, prev.x, prev.y, cur.x, cur.y, tolerance)) {
        hitIds.add(shape.id);
      }
    }
    this._marked = [...hitIds];
    this.editor.setErasingShapes(this._marked);
  }

  private finish(): void {
    const ids = this.editor.getErasingShapeIds();
    if (ids.length > 0) {
      this.editor.store.deleteShapes(ids);
    }
    this.editor.setErasingShapes([]);
    this._marked = [];
    this.ctx.transition('eraser_idle');
  }
}
