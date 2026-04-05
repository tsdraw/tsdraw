import type { ToolId } from '@tsdraw/core';
import { isSelectTool } from '@tsdraw/core';

export function getCanvasCursor(
  currentTool: ToolId,
  state: {
    isMovingSelection: boolean;
    isResizingSelection: boolean;
    isRotatingSelection: boolean;
    isDraggingVertex: boolean;
    isHoveringSelectionBounds: boolean;
    showToolOverlay: boolean;
  }
) {
  if (currentTool === 'hand') return 'grab';

  if (isSelectTool(currentTool)) {
    if (state.isRotatingSelection) return 'grabbing';
    if (state.isResizingSelection) return 'nwse-resize';
    if (state.isMovingSelection) return 'grabbing';
    if (state.isDraggingVertex) return 'grabbing';
    if (state.isHoveringSelectionBounds) return 'move';
    return 'default';
  }

  return state.showToolOverlay ? 'none' : 'crosshair'; // Let tool overlay handle the cursor
}