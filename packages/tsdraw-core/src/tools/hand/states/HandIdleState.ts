import { StateNode, type ToolPointerDownInfo } from '../../../store/stateNode.js';

export class HandIdleState extends StateNode {
  static override id = 'hand_idle';

  override onPointerDown(info?: ToolPointerDownInfo): void {
    this.ctx.transition('hand_dragging', info);
  }
}