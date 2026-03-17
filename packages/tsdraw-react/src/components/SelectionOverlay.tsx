import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ResizeHandle, ToolId } from 'tsdraw-core';
import type { ScreenRect } from '../types.js';

interface SelectionOverlayProps {
  selectionBrush: ScreenRect | null;
  selectionBounds: ScreenRect | null;
  selectionRotationDeg: number;
  currentTool: ToolId;
  selectedCount: number;
  onRotatePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerDown: (e: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void;
}

export function SelectionOverlay({
  selectionBrush,
  selectionBounds,
  selectionRotationDeg,
  currentTool,
  selectedCount,
  onRotatePointerDown,
  onResizePointerDown,
}: SelectionOverlayProps) {
  return (
    <>
      {selectionBrush && (
        <div
          className="tsdraw-selection-brush"
          style={{
            left: selectionBrush.left,
            top: selectionBrush.top,
            width: selectionBrush.width,
            height: selectionBrush.height,
          }}
        />
      )}
      {selectionBounds && (
        <div
          className="tsdraw-selection-frame"
          style={{
            left: selectionBounds.left,
            top: selectionBounds.top,
            width: selectionBounds.width,
            height: selectionBounds.height,
            transform: `rotate(${selectionRotationDeg}deg)`,
          }}
        >
          <div className="tsdraw-selection-bounds" />
          {currentTool === 'select' && selectedCount > 0 && (
            <>
              <div className="tsdraw-rotation-stem" />
              <button
                type="button"
                className="tsdraw-rotation-handle"
                aria-label="Rotate selection"
                onPointerDown={onRotatePointerDown}
              />
              <button
                type="button"
                className="tsdraw-selection-handle tsdraw-selection-handle--nw"
                style={{ left: '0%', top: '0%' }}
                aria-label="Resize top left"
                onPointerDown={(e) => onResizePointerDown(e, 'nw')}
              />
              <button
                type="button"
                className="tsdraw-selection-handle tsdraw-selection-handle--ne"
                style={{ left: '100%', top: '0%' }}
                aria-label="Resize top right"
                onPointerDown={(e) => onResizePointerDown(e, 'ne')}
              />
              <button
                type="button"
                className="tsdraw-selection-handle tsdraw-selection-handle--sw"
                style={{ left: '0%', top: '100%' }}
                aria-label="Resize bottom left"
                onPointerDown={(e) => onResizePointerDown(e, 'sw')}
              />
              <button
                type="button"
                className="tsdraw-selection-handle tsdraw-selection-handle--se"
                style={{ left: '100%', top: '100%' }}
                aria-label="Resize bottom right"
                onPointerDown={(e) => onResizePointerDown(e, 'se')}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}