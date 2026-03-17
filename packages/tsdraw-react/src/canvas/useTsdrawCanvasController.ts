import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Editor,
  normalizeSelectionBounds,
  applyMove,
  applyResize,
  applyRotation,
  buildStartPositions,
  buildTransformSnapshots,
  getSelectionBoundsPage,
  getShapesInBounds,
  getTopShapeAtPoint,
  type ResizeHandle,
  type ToolId,
} from 'tsdraw-core';
import type { ColorStyle, DashStyle, ShapeId, SizeStyle, SelectionBounds } from 'tsdraw-core';
import { getCanvasCursor } from './cursor.js';
import { shouldShowPenStylePanel } from '../tools/pen/penTool.js';
import type { ScreenRect } from '../types.js';

type SelectDragMode = 'none' | 'marquee' | 'move' | 'resize' | 'rotate';

export interface TsdrawCanvasController {
  containerRef: React.RefObject<HTMLDivElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  currentTool: ToolId;
  drawColor: ColorStyle;
  drawDash: DashStyle;
  drawSize: SizeStyle;
  selectedShapeIds: ShapeId[];
  selectionBrush: ScreenRect | null;
  selectionBounds: ScreenRect | null;
  selectionRotationDeg: number;
  canvasCursor: string;
  showStylePanel: boolean;
  setTool: (tool: ToolId) => void;
  applyDrawStyle: (partial: Partial<{ color: ColorStyle; dash: DashStyle; size: SizeStyle }>) => void;
  handleResizePointerDown: (e: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void;
  handleRotatePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}

function toScreenRect(editor: Editor, bounds: SelectionBounds): ScreenRect {
  const { x, y, zoom } = editor.viewport;
  return {
    left: bounds.minX * zoom + x,
    top: bounds.minY * zoom + y,
    width: (bounds.maxX - bounds.minX) * zoom,
    height: (bounds.maxY - bounds.minY) * zoom,
  };
}

export function useTsdrawCanvasController(): TsdrawCanvasController {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const dprRef = useRef(1);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const currentToolRef = useRef<ToolId>('pen');
  const selectedShapeIdsRef = useRef<ShapeId[]>([]);
  const selectionRotationRef = useRef(0);
  const resizeRef = useRef<{
    handle: ResizeHandle | null;
    startBounds: ReturnType<typeof getSelectionBoundsPage>;
    startShapes: ReturnType<typeof buildTransformSnapshots>;
  }>({
    handle: null,
    startBounds: null,
    startShapes: new Map(),
  });
  const rotateRef = useRef<{
    center: { x: number; y: number } | null;
    startAngle: number;
    startSelectionRotationDeg: number;
    startShapes: ReturnType<typeof buildTransformSnapshots>;
  }>({
    center: null,
    startAngle: 0,
    startSelectionRotationDeg: 0,
    startShapes: new Map(),
  });
  const selectDragRef = useRef<{
    mode: SelectDragMode;
    startPage: { x: number; y: number };
    currentPage: { x: number; y: number };
    startPositions: ReturnType<typeof buildStartPositions>;
    additive: boolean;
    initialSelection: ShapeId[];
  }>({
    mode: 'none',
    startPage: { x: 0, y: 0 },
    currentPage: { x: 0, y: 0 },
    startPositions: new Map(),
    additive: false,
    initialSelection: [],
  });

  const [currentTool, setCurrentToolState] = useState<ToolId>('pen');
  const [drawColor, setDrawColor] = useState<ColorStyle>('black');
  const [drawDash, setDrawDash] = useState<DashStyle>('draw');
  const [drawSize, setDrawSize] = useState<SizeStyle>('m');
  const [selectedShapeIds, setSelectedShapeIds] = useState<ShapeId[]>([]);
  const [selectionBrush, setSelectionBrush] = useState<ScreenRect | null>(null);
  const [selectionBounds, setSelectionBounds] = useState<ScreenRect | null>(null);
  const [selectionRotationDeg, setSelectionRotationDeg] = useState(0);
  const [isMovingSelection, setIsMovingSelection] = useState(false);
  const [isResizingSelection, setIsResizingSelection] = useState(false);
  const [isRotatingSelection, setIsRotatingSelection] = useState(false);

  useEffect(() => {
    currentToolRef.current = currentTool;
  }, [currentTool]);

  useEffect(() => {
    selectedShapeIdsRef.current = selectedShapeIds;
  }, [selectedShapeIds]);

  useEffect(() => {
    selectionRotationRef.current = selectionRotationDeg;
  }, [selectionRotationDeg]);

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

  // Keep overlays screen-space bounds in sync with the current page-space selection
  const refreshSelectionBounds = useCallback((editor: Editor, ids = selectedShapeIdsRef.current) => {
    const pageBounds = getSelectionBoundsPage(editor, ids);
    setSelectionBounds(pageBounds ? toScreenRect(editor, pageBounds) : null);
  }, []);

  const getPagePointFromClient = useCallback((editor: Editor, clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return editor.screenToPage(clientX - rect.left, clientY - rect.top);
  }, []);

  const resetSelectUi = useCallback(() => {
    setSelectionBrush(null);
    setSelectionRotationDeg(0);
    setIsMovingSelection(false);
    setIsResizingSelection(false);
    setIsRotatingSelection(false);
    selectDragRef.current.mode = 'none';
    resizeRef.current = { handle: null, startBounds: null, startShapes: new Map() };
    rotateRef.current = {
      center: null,
      startAngle: 0,
      startSelectionRotationDeg: selectionRotationRef.current,
      startShapes: new Map(),
    };
  }, []);

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
      e.preventDefault();
      e.stopPropagation();
      const editor = editorRef.current;
      if (!editor || selectedShapeIdsRef.current.length === 0) return;
      const bounds = getSelectionBoundsPage(editor, selectedShapeIdsRef.current);
      if (!bounds) return;

      resizeRef.current = {
        handle,
        startBounds: bounds,
        startShapes: buildTransformSnapshots(editor, selectedShapeIdsRef.current),
      };
      selectDragRef.current.mode = 'resize';
      const p = getPagePointFromClient(editor, e.clientX, e.clientY);
      editor.input.pointerDown(p.x, p.y, 0.5, false);
      selectDragRef.current.startPage = p;
      selectDragRef.current.currentPage = p;
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
      setIsResizingSelection(true);
    },
    [getPagePointFromClient]
  );

  const handleRotatePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const editor = editorRef.current;
      if (!editor || selectedShapeIdsRef.current.length === 0) return;
      const bounds = getSelectionBoundsPage(editor, selectedShapeIdsRef.current);
      if (!bounds) return;

      const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };
      const p = getPagePointFromClient(editor, e.clientX, e.clientY);
      rotateRef.current = {
        center,
        startAngle: Math.atan2(p.y - center.y, p.x - center.x),
        startSelectionRotationDeg: selectionRotationRef.current,
        startShapes: buildTransformSnapshots(editor, selectedShapeIdsRef.current),
      };
      selectDragRef.current.mode = 'rotate';
      editor.input.pointerDown(p.x, p.y, 0.5, false);
      selectDragRef.current.startPage = p;
      selectDragRef.current.currentPage = p;
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
      setIsRotatingSelection(true);
    },
    [getPagePointFromClient]
  );

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
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      editor.viewport.x = 0;
      editor.viewport.y = 0;
      editor.viewport.zoom = 1;
      render();
      refreshSelectionBounds(editor);
    };

    const getPagePoint = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return editor.screenToPage(e.clientX - rect.left, e.clientY - rect.top);
    };

    const sampleEvents = (e: PointerEvent) => {
      const coalesced = e.getCoalescedEvents?.();
      return coalesced && coalesced.length > 0 ? coalesced : [e];
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!canvas.contains(e.target as Node)) return;
      canvas.setPointerCapture(e.pointerId);
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };

      const first = sampleEvents(e)[0]!;
      const { x, y } = getPagePoint(first);
      const pressure = first.pressure ?? 0.5;
      const isPen = first.pointerType === 'pen' || first.pointerType === 'touch';

      if (currentToolRef.current === 'select') {
        const hit = getTopShapeAtPoint(editor, { x, y });
        const isHitSelected = !!(hit && selectedShapeIdsRef.current.includes(hit.id));

        if (isHitSelected) {
          selectDragRef.current = {
            mode: 'move',
            startPage: { x, y },
            currentPage: { x, y },
            startPositions: buildStartPositions(editor, selectedShapeIdsRef.current),
            additive: false,
            initialSelection: [...selectedShapeIdsRef.current],
          };
          setIsMovingSelection(true);
          return;
        }

        selectDragRef.current = {
          mode: 'marquee',
          startPage: { x, y },
          currentPage: { x, y },
          startPositions: new Map(),
          additive: first.shiftKey,
          initialSelection: [...selectedShapeIdsRef.current],
        };
        setSelectionBrush({ left: e.offsetX, top: e.offsetY, width: 0, height: 0 });
        if (!e.shiftKey) {
          setSelectedShapeIds([]);
          selectedShapeIdsRef.current = [];
          setSelectionBounds(null);
          setSelectionRotationDeg(0);
        }
        return;
      }

      editor.input.pointerDown(x, y, pressure, isPen);
      editor.input.setModifiers(first.shiftKey, first.ctrlKey, first.metaKey);
      editor.tools.pointerDown({ point: { x, y, z: pressure } });
      render();
      refreshSelectionBounds(editor);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const prevClient = lastPointerClientRef.current;
      const dx = prevClient ? e.clientX - prevClient.x : 0;
      const dy = prevClient ? e.clientY - prevClient.y : 0;
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };

      for (const sample of sampleEvents(e)) {
        const { x, y } = getPagePoint(sample);
        const pressure = sample.pressure ?? 0.5;
        const isPen = sample.pointerType === 'pen' || sample.pointerType === 'touch';
        editor.input.pointerMove(x, y, pressure, isPen);
      }

      if (currentToolRef.current === 'select') {
        const mode = selectDragRef.current.mode;
        const { x: px, y: py } = editor.input.getCurrentPagePoint();

        if (mode === 'rotate') {
          const { center, startAngle, startSelectionRotationDeg, startShapes } = rotateRef.current;
          if (!center) return;
          const angle = Math.atan2(py - center.y, px - center.x);
          const delta = angle - startAngle;
          setSelectionRotationDeg(startSelectionRotationDeg + (delta * 180) / Math.PI);
          applyRotation(editor, startShapes, center, delta);
          render();
          return;
        }

        // Resize and move both work using captured snapshots so the transform stays stable throughout the drag instead of adding up shape updates on each pointer move
        if (mode === 'resize') {
          const { handle, startBounds, startShapes } = resizeRef.current;
          if (!handle || !startBounds) return;
          applyResize(editor, handle, startBounds, startShapes, { x: px, y: py }, e.shiftKey);
          render();
          refreshSelectionBounds(editor);
          return;
        }

        if (mode === 'move') {
          const drag = selectDragRef.current;
          applyMove(editor, drag.startPositions, px - drag.startPage.x, py - drag.startPage.y);
          render();
          refreshSelectionBounds(editor);
          return;
        }

        // Marquee selection updates live as brush changes so that the overlay matches feedback
        if (mode === 'marquee') {
          selectDragRef.current.currentPage = { x: px, y: py };
          const pageRect = normalizeSelectionBounds(selectDragRef.current.startPage, selectDragRef.current.currentPage);
          setSelectionBrush(toScreenRect(editor, pageRect));
          const ids = getShapesInBounds(editor, pageRect);
          const nextIds = selectDragRef.current.additive ? Array.from(new Set([...selectDragRef.current.initialSelection, ...ids])) : ids;
          setSelectedShapeIds(nextIds);
          selectedShapeIdsRef.current = nextIds;
          setSelectionRotationDeg(0);
          refreshSelectionBounds(editor, nextIds);
          return;
        }
      }

      editor.input.setModifiers(e.shiftKey, e.ctrlKey, e.metaKey);
      editor.tools.pointerMove({ screenDeltaX: dx, screenDeltaY: dy });
      render();
      refreshSelectionBounds(editor);
    };

    const handlePointerUp = (e: PointerEvent) => {
      lastPointerClientRef.current = null;
      const { x, y } = getPagePoint(e);
      editor.input.pointerMove(x, y);
      editor.input.pointerUp();

      if (currentToolRef.current === 'select') {
        const drag = selectDragRef.current;

        // Rotation resets overlay back to normal selection box after release while rotated geometry stays
        if (drag.mode === 'rotate') {
          setIsRotatingSelection(false);
          selectDragRef.current.mode = 'none';
          setSelectionRotationDeg(0);
          rotateRef.current = {
            center: null,
            startAngle: 0,
            startSelectionRotationDeg: selectionRotationRef.current,
            startShapes: new Map(),
          };
          render();
          refreshSelectionBounds(editor);
          return;
        }

        if (drag.mode === 'resize') {
          setIsResizingSelection(false);
          selectDragRef.current.mode = 'none';
          resizeRef.current = { handle: null, startBounds: null, startShapes: new Map() };
          render();
          refreshSelectionBounds(editor);
          return;
        }

        if (drag.mode === 'move') {
          setIsMovingSelection(false);
          selectDragRef.current.mode = 'none';
          render();
          refreshSelectionBounds(editor);
          return;
        }

        if (drag.mode === 'marquee') {
          const rect = normalizeSelectionBounds(drag.startPage, { x, y });
          const moved = Math.abs(x - drag.startPage.x) > 2 || Math.abs(y - drag.startPage.y) > 2;
          let ids: ShapeId[] = [];

          if (!moved) {
            const hit = getTopShapeAtPoint(editor, { x, y });
            if (hit) {
              ids = drag.additive ? Array.from(new Set([...drag.initialSelection, hit.id])) : [hit.id];
            } else {
              ids = drag.additive ? drag.initialSelection : [];
            }
          } else {
            ids = getShapesInBounds(editor, rect);
            if (drag.additive) {
              ids = Array.from(new Set([...drag.initialSelection, ...ids]));
            }
          }

          setSelectedShapeIds(ids);
          selectedShapeIdsRef.current = ids;
          setSelectionRotationDeg(0);
          setSelectionBrush(null);
          selectDragRef.current.mode = 'none';
          render();
          refreshSelectionBounds(editor, ids);
          return;
        }
      }

      editor.tools.pointerUp({});
      render();
      refreshSelectionBounds(editor);
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

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
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
  }, [getPagePointFromClient, refreshSelectionBounds, render]);

  const setTool = useCallback(
    (tool: ToolId) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.setCurrentTool(tool);
      setCurrentToolState(tool);
      currentToolRef.current = tool;
      if (tool !== 'select') resetSelectUi();
    },
    [resetSelectUi]
  );

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

  return {
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
    canvasCursor: getCanvasCursor(currentTool, {
      isMovingSelection,
      isResizingSelection,
      isRotatingSelection,
    }),
    showStylePanel: shouldShowPenStylePanel(currentTool),
    setTool,
    applyDrawStyle,
    handleResizePointerDown,
    handleRotatePointerDown,
  };
}
