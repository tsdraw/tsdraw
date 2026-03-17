import { StateNode } from '../../../store/stateNode.js';

export class HandIdleState extends StateNode {
  static override id = 'hand_idle';

  override onPointerDown(info: unknown): void {
    this.ctx.transition('hand_dragging', info);
  }
}