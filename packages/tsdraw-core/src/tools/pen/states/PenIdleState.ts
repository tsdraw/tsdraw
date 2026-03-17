import { StateNode, type ToolPointerDownInfo } from '../../../store/stateNode.js';

export class PenIdleState extends StateNode {
  static override id = 'pen_idle';

  override onPointerDown(info?: ToolPointerDownInfo): void {
    this.ctx.transition('pen_drawing', info);
  }
}