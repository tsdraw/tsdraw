import { useRef, useEffect, useCallback, useState } from 'react';
import { IconEraser, IconPencil } from '@tabler/icons-react';
import { Editor, DEFAULT_COLORS } from 'tsdraw-core';
import type { ColorStyle, DashStyle, SizeStyle } from 'tsdraw-core';

export interface TsdrawCanvasProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

const STYLE_COLORS = Object.entries(DEFAULT_COLORS)
  .filter(([key]) => key !== 'white')
  .map(([value, solid]) => ({ value, solid }));

const STYLE_DASHES: DashStyle[] = ['draw', 'solid', 'dashed', 'dotted'];
const STYLE_SIZES: SizeStyle[] = ['s', 'm', 'l', 'xl'];

// Main canvas component: drawing surface with toolbar
export function TsdrawCanvas(props: TsdrawCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const dprRef = useRef(1);
  const [currentTool, setCurrentTool] = useState<'pen' | 'eraser'>('pen');
  const [drawColor, setDrawColor] = useState<ColorStyle>('black');
  const [drawDash, setDrawDash] = useState<DashStyle>('draw');
  const [drawSize, setDrawSize] = useState<SizeStyle>('m');

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const editor = editorRef.current;
    if (!canvas || !editor) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = dprRef.current || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    editor.render(ctx);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const editor = new Editor();
    editorRef.current = editor;

    const initialStyle = editor.getCurrentDrawStyle();
    setDrawColor(initialStyle.color);
    setDrawDash(initialStyle.dash);
    setDrawSize(initialStyle.size);

    const resize = () => {
      const dpr = window.devicePixelRatio ?? 1;
      dprRef.current = dpr;
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      editor.viewport.x = 0;
      editor.viewport.y = 0;
      editor.viewport.zoom = 1;
      render();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const getPagePoint = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      return editor.screenToPage(sx, sy);
    };

    const sampleEvents = (e: PointerEvent) => {
      const coalesced = e.getCoalescedEvents?.();
      return coalesced && coalesced.length > 0 ? coalesced : [e];
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!canvas.contains(e.target as Node)) return;
      canvas.setPointerCapture(e.pointerId);
      const first = sampleEvents(e)[0]!;
      const { x, y } = getPagePoint(first);
      const pressure = first.pressure ?? 0.5;
      const isPen = first.pointerType === 'pen' || first.pointerType === 'touch';
      editor.input.pointerDown(x, y, pressure, isPen);
      editor.input.setModifiers(first.shiftKey, first.ctrlKey, first.metaKey);
      editor.tools.pointerDown({ point: { x, y, z: pressure } });
      render();
    };

    const handlePointerMove = (e: PointerEvent) => {
      const samples = sampleEvents(e);
      for (const sample of samples) {
        const { x, y } = getPagePoint(sample);
        const pressure = sample.pressure ?? 0.5;
        const isPen = sample.pointerType === 'pen' || sample.pointerType === 'touch';
        editor.input.pointerMove(x, y, pressure, isPen);
      }
      editor.input.setModifiers(e.shiftKey, e.ctrlKey, e.metaKey);
      editor.tools.pointerMove({});
      render();
    };

    const handlePointerUp = (e: PointerEvent) => {
      const { x, y } = getPagePoint(e);
      editor.input.pointerMove(x, y);
      editor.input.pointerUp();
      editor.tools.pointerUp({});
      render();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      editor.input.setModifiers(e.shiftKey, e.ctrlKey, e.metaKey);
      editor.tools.keyDown({ key: e.key });
      render();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      editor.input.setModifiers(e.shiftKey, e.ctrlKey, e.metaKey);
      editor.tools.keyUp({ key: e.key });
      render();
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      editorRef.current = null;
    };
  }, [render]);

  const setTool = useCallback((tool: 'pen' | 'eraser') => {
    const editor = editorRef.current;
    if (editor) {
      editor.setCurrentTool(tool);
      setCurrentTool(tool);
    }
  }, []);

  const applyDrawStyle = useCallback(
    (partial: Partial<{ color: ColorStyle; dash: DashStyle; size: SizeStyle }>) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.setCurrentDrawStyle(partial);
      if (partial.color) setDrawColor(partial.color);
      if (partial.dash) setDrawDash(partial.dash);
      if (partial.size) setDrawSize(partial.size);
      render();
    },
    [render]
  );

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
          cursor: 'crosshair',
        }}
        data-testid="tsdraw-canvas"
      />
      {currentTool === 'pen' && (
        <div className="tsdraw-style-panel" aria-label="Draw style panel">
          <div className="tsdraw-style-colors">
            {STYLE_COLORS.map((item) => (
              <button
                key={item.value}
                type="button"
                className="tsdraw-style-color"
                data-active={drawColor === item.value ? 'true' : undefined}
                aria-label={`Color ${item.value}`}
                title={item.value}
                onClick={() => applyDrawStyle({ color: item.value })}
              >
                <span
                  className="tsdraw-style-color-dot"
                  style={{ background: item.solid }}
                />
              </button>
            ))}
          </div>
          <div className="tsdraw-style-section">
            {STYLE_DASHES.map((dash) => (
              <button
                key={dash}
                type="button"
                className="tsdraw-style-row"
                data-active={drawDash === dash ? 'true' : undefined}
                aria-label={`Stroke ${dash}`}
                title={dash}
                onClick={() => applyDrawStyle({ dash })}
              >
                <span className="tsdraw-style-preview">
                  <span className={`tsdraw-style-preview-line tsdraw-style-preview-line--${dash}`} />
                </span>
              </button>
            ))}
          </div>
          <div className="tsdraw-style-section">
            {STYLE_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className="tsdraw-style-row"
                data-active={drawSize === size ? 'true' : undefined}
                aria-label={`Thickness ${size}`}
                title={size}
                onClick={() => applyDrawStyle({ size })}
              >
                <span className="tsdraw-style-preview">
                  <span className={`tsdraw-style-size tsdraw-style-size--${size}`} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="tsdraw-toolbar">
        <button
          type="button"
          className="tsdraw-toolbar-btn"
          data-active={currentTool === 'pen' ? 'true' : undefined}
          onClick={() => setTool('pen')}
          title="Pen"
          aria-label="Pen"
        >
          <IconPencil 
            size={18} 
            stroke={1.8} 
            fill={currentTool === 'pen' ? 'currentColor' : 'none'} 
          />
        </button>
        <button
          type="button"
          className="tsdraw-toolbar-btn"
          data-active={currentTool === 'eraser' ? 'true' : undefined}
          onClick={() => setTool('eraser')}
          title="Eraser"
          aria-label="Eraser"
        >
          <IconEraser 
            size={18} 
            stroke={1.8} 
            fill={currentTool === 'eraser' ? 'currentColor' : 'none'} 
          />
        </button>
      </div>
    </div>
  );
}
