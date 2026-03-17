import { SelectionOverlay } from './SelectionOverlay.js';
import { StylePanel } from './StylePanel.js';
import { ToolOverlay } from './ToolOverlay.js';
import { Toolbar } from './Toolbar.js';
import { useTsdrawCanvasController } from '../canvas/useTsdrawCanvasController.js';

export interface TsdrawCanvasProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function TsdrawCanvas(props: TsdrawCanvasProps) {
  const {
    containerRef,
    canvasRef,
    currentTool,
    drawColor,
    drawDash,
    drawSize,
    selectedShapeIds,
    selectionBrush,
    selectionBounds,
    selectionRotationDeg,
    canvasCursor,
    toolOverlay,
    showStylePanel,
    setTool,
    applyDrawStyle,
    handleResizePointerDown,
    handleRotatePointerDown,
  } = useTsdrawCanvasController();

  return (
    <div
      ref={containerRef}
      className={`tsdraw-container ${props.className ?? ''}`}
      style={{
        width: props.width ?? '100%',
        height: props.height ?? '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
          cursor: canvasCursor,
        }}
        data-testid="tsdraw-canvas"
      />
      <ToolOverlay
        visible={toolOverlay.visible}
        pointerX={toolOverlay.pointerX}
        pointerY={toolOverlay.pointerY}
        isPenPreview={toolOverlay.isPenPreview}
        penRadius={toolOverlay.penRadius}
        penColor={toolOverlay.penColor}
        eraserRadius={toolOverlay.eraserRadius}
      />
      <SelectionOverlay
        selectionBrush={selectionBrush}
        selectionBounds={selectionBounds}
        selectionRotationDeg={selectionRotationDeg}
        currentTool={currentTool}
        selectedCount={selectedShapeIds.length}
        onRotatePointerDown={handleRotatePointerDown}
        onResizePointerDown={handleResizePointerDown}
      />
      <StylePanel
        visible={showStylePanel}
        drawColor={drawColor}
        drawDash={drawDash}
        drawSize={drawSize}
        onColorSelect={(color) => applyDrawStyle({ color })}
        onDashSelect={(dash) => applyDrawStyle({ dash })}
        onSizeSelect={(size) => applyDrawStyle({ size })}
      />
      <Toolbar currentTool={currentTool} onToolChange={setTool} />
    </div>
  );
}
