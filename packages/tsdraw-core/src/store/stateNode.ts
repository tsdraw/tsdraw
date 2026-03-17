import type { IEditor } from '../editor/editorTypes.js';
import type { Vec3 } from '../types.js';

// Types for tool state events
export interface ToolPointerDownInfo {
  point: Vec3;
}

export interface ToolPointerMoveInfo {
  screenDeltaX?: number;
  screenDeltaY?: number;
}

export interface ToolKeyInfo {
  key: string;
}

export type ToolStateTransitionInfo = | ToolPointerDownInfo | ToolPointerMoveInfo | ToolKeyInfo;

export interface ToolStateContext {
  transition(stateId: string, info?: ToolStateTransitionInfo): void;
}

// State node in the tool state machine
export abstract class StateNode {
  static id: string = 'base';

  constructor(
    protected ctx: ToolStateContext,
    protected editor: IEditor
  ) {}

  onEnter(_info?: ToolStateTransitionInfo): void {}
  onExit(_info?: ToolStateTransitionInfo, _to?: string): void {}
  onPointerDown(_info?: ToolPointerDownInfo): void {}
  onPointerMove(_info?: ToolPointerMoveInfo): void {}
  onPointerUp(): void {}
  onKeyDown(_info?: ToolKeyInfo): void {}
  onKeyUp(_info?: ToolKeyInfo): void {}
  onCancel(): void {}
  onInterrupt(): void {}
}
