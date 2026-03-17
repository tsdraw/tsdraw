import type {
  StateNode,
  ToolKeyInfo,
  ToolPointerDownInfo,
  ToolPointerMoveInfo,
  ToolStateTransitionInfo,
} from '../store/stateNode.js';

export type ToolId = 'pen' | 'eraser' | 'select' | 'hand';

// Manages current tool and passes pointer/key events to state nodes
export class ToolManager {
  private currentToolId: ToolId = 'pen';
  private currentState: StateNode | null = null;
  private states: Map<string, StateNode> = new Map();

  registerState(state: StateNode): void {
    const ctor = state.constructor as typeof StateNode;
    this.states.set(ctor.id, state);
  }

  setCurrentTool(id: ToolId): void {
    this.currentToolId = id;
    const initial = this.getInitialStateForTool(id);
    if (initial) {
      this.currentState = this.states.get(initial) ?? null;
      this.currentState?.onEnter?.();
    }
  }

  getCurrentToolId(): ToolId {
    return this.currentToolId;
  }

  getCurrentState(): StateNode | null {
    return this.currentState;
  }

  private getInitialStateForTool(id: ToolId): string {
    if (id === 'pen') return 'pen_idle';
    if (id === 'eraser') return 'eraser_idle';
    if (id === 'select') return 'select_idle';
    if (id === 'hand') return 'hand_idle';
    return 'pen_idle';
  }

  transition(stateId: string, info?: ToolStateTransitionInfo): void {
    const next = this.states.get(stateId);
    if (!next) return;
    this.currentState?.onExit?.(undefined, stateId);
    this.currentState = next;
    this.currentState.onEnter?.(info);
  }

  pointerDown(info: ToolPointerDownInfo): void { this.currentState?.onPointerDown?.(info); }
  pointerMove(info: ToolPointerMoveInfo): void { this.currentState?.onPointerMove?.(info); }
  pointerUp(): void { this.currentState?.onPointerUp?.(); }

  keyDown(info: ToolKeyInfo): void { this.currentState?.onKeyDown?.(info); }
  keyUp(info: ToolKeyInfo): void { this.currentState?.onKeyUp?.(info); }

  cancel(): void { this.currentState?.onCancel?.(); }
  interrupt(): void { this.currentState?.onInterrupt?.(); }
}
