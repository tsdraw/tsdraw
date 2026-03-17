interface ToolOverlayProps {
  visible: boolean;
  pointerX: number;
  pointerY: number;
  isPenPreview: boolean;
  penRadius: number;
  penColor: string;
  eraserRadius: number;
}

export function ToolOverlay({
  visible,
  pointerX,
  pointerY,
  isPenPreview,
  penRadius,
  penColor,
  eraserRadius,
}: ToolOverlayProps) {
  if (!visible) return null;

  return (
    <div className="tsdraw-tool-overlay" aria-hidden="true">
      {isPenPreview ? (
        <span
          className="tsdraw-tool-dot"
          style={{
            left: pointerX,
            top: pointerY,
            width: penRadius * 2,
            height: penRadius * 2,
            backgroundColor: penColor,
          }}
        />
      ) : (
        <span
          className="tsdraw-tool-ring"
          style={{
            left: pointerX,
            top: pointerY,
            width: eraserRadius * 2,
            height: eraserRadius * 2,
          }}
        />
      )}
    </div>
  );
}
