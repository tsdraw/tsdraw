import { StateNode, type ToolPointerDownInfo } from '../../../store/stateNode.js';

export class EraserIdleState extends StateNode {
  static override id = 'eraser_idle';

  override onPointerDown(info?: ToolPointerDownInfo): void {
    this.ctx.transition('eraser_pointing', info);
  }
}