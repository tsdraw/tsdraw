import { StateNode } from '../../../store/stateNode.js';

type HandMoveInfo = {
  screenDeltaX?: number;
  screenDeltaY?: number;
};

export class HandDraggingState extends StateNode {
  static override id = 'hand_dragging';

  override onPointerMove(info: unknown): void {
    const move = (info ?? {}) as HandMoveInfo;
    const dx = move.screenDeltaX ?? 0;
    const dy = move.screenDeltaY ?? 0;
    if (dx === 0 && dy === 0) return;
    this.editor.panBy(dx, dy);
  }

  override onPointerUp(): void {
    this.ctx.transition('hand_idle');
  }

  override onCancel(): void {
    this.ctx.transition('hand_idle');
  }

  override onInterrupt(): void {
    this.ctx.transition('hand_idle');
  }
}