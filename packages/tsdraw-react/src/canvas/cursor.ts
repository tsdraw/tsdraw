import type { ToolId } from 'tsdraw-core';
import { getEraserCursor, isEraserTool } from '../tools/eraser/eraserTool.js';
import { getHandCursor, isHandTool } from '../tools/hand/handTool.js';
import { getPenCursor, isPenTool } from '../tools/pen/penTool.js';
import { isSelectTool } from 'tsdraw-core';

export function getCanvasCursor(
  currentTool: ToolId,
  state: { isMovingSelection: boolean; isResizingSelection: boolean; isRotatingSelection: boolean }
) {
  if (isHandTool(currentTool)) return getHandCursor();

  if (isSelectTool(currentTool)) {
    if (state.isRotatingSelection) return 'grabbing';
    if (state.isResizingSelection) return 'nwse-resize';
    if (state.isMovingSelection) return 'grabbing';
    return 'default';
  }

  if (isEraserTool(currentTool)) return getEraserCursor();
  if (isPenTool(currentTool)) return getPenCursor();

  return 'default';
}