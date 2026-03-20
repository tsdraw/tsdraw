import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RefObject } from 'react';
import {
  Editor,
  ERASER_MARGIN,
  STROKE_WIDTHS,
  pageToScreen,
  normalizeSelectionBounds,
  applyMove,
  applyResize,
  applyRotation,
  buildStartPositions,
  buildTransformSnapshots,
  getSelectionBoundsPage,
  getShapesInBounds,
  getTopShapeAtPoint,
  resolveThemeColor,
  type ResizeHandle,
  type ToolDefinition,
  type ToolId,
} from '@tsdraw/core';
import type { ColorStyle, DashStyle, FillStyle, ShapeId, SizeStyle, SelectionBounds, TsdrawDocumentSnapshot, TsdrawEditorSnapshot } from '@tsdraw/core';
import { getCanvasCursor } from './cursor.js';
import { createTouchInteractionController } from './touchInteractions.js';
import { handleKeyboardShortcutKeyDown, handleKeyboardShortcutKeyUp } from './keyboardShortcuts.js';
import type { ScreenRect } from '../types.js';
import { TsdrawLocalIndexedDb } from '../persistence/localIndexedDb.js';
import { getOrCreateSessionId } from '../persistence/sessionId.js';

type SelectDragMode = 'none' | 'marquee' | 'move' | 'resize' | 'rotate';

export interface TsdrawCursorContext {
  currentTool: ToolId;
  defaultCursor: string;
  showToolOverlay: boolean;
  isMovingSelection: boolean;
  isResizingSelection: boolean;
  isRotatingSelection: boolean;
}

export interface TsdrawToolOverlayState {
  visible: boolean;
  pointerX: number;
  pointerY: number;
  isPenPreview: boolean;
  penRadius: number;
  penColor: string;
  eraserRadius: number;
}

export interface TsdrawMountApi {
  editor: Editor;
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  setTool: (tool: ToolId) => void;
  getCurrentTool: () => ToolId;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  applyDrawStyle: (partial: Partial<{ color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle }>) => void;
}

export interface UseTsdrawCanvasControllerOptions {
  toolDefinitions?: ToolDefinition[];
  initialTool?: ToolId;
  theme?: 'light' | 'dark';
  persistenceKey?: string;
  onMount?: (api: TsdrawMountApi) => void | (() => void);
}

export interface TsdrawCanvasController {
  containerRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  currentTool: ToolId;
  drawColor: ColorStyle;
  drawDash: DashStyle;
  drawFill: FillStyle;
  drawSize: SizeStyle;
  selectedShapeIds: ShapeId[];
  selectionBrush: ScreenRect | null;
  selectionBounds: ScreenRect | null;
  selectionRotationDeg: number;
  canvasCursor: string;
  cursorContext: TsdrawCursorContext;
  toolOverlay: TsdrawToolOverlayState;
  isPersistenceReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => boolean;
  redo: () => boolean;
  setTool: (tool: ToolId) => void;
  applyDrawStyle: (partial: Partial<{ color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle }>) => void;
  handleResizePointerDown: (e: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void;
  handleRotatePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}

function toScreenRect(editor: Editor, bounds: SelectionBounds): ScreenRect {
  const topLeft = pageToScreen(editor.viewport, bounds.minX, bounds.minY);
  const topRight = pageToScreen(editor.viewport, bounds.maxX, bounds.minY);
  const bottomLeft = pageToScreen(editor.viewport, bounds.minX, bounds.maxY);
  const bottomRight = pageToScreen(editor.viewport, bounds.maxX, bounds.maxY);
  const minX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
  const maxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const maxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
  return {
    left: minX,
    top: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function resolveDrawColor(colorStyle: ColorStyle, theme: 'light' | 'dark'): string {
  return resolveThemeColor(colorStyle, theme);
}

const ZOOM_WHEEL_CAP = 10;

export function useTsdrawCanvasController(options: UseTsdrawCanvasControllerOptions = {}): TsdrawCanvasController {
  const onMountRef = useRef(options.onMount);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const dprRef = useRef(1);
  const penDetectedRef = useRef(false);
  const penModeRef = useRef(false);
  const lastPointerDownWithRef = useRef<'mouse' | 'touch' | 'pen'>('mouse');
  const activePointerIdsRef = useRef(new Set<number>());
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const currentToolRef = useRef<ToolId>(options.initialTool ?? 'pen');
  const selectedShapeIdsRef = useRef<ShapeId[]>([]);
  const schedulePersistRef = useRef<(() => void) | null>(null);
  const isPointerActiveRef = useRef(false);
  const pendingRemoteDocumentRef = useRef<TsdrawDocumentSnapshot | null>(null);
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

  const [currentTool, setCurrentToolState] = useState<ToolId>(options.initialTool ?? 'pen');
  const [drawColor, setDrawColor] = useState<ColorStyle>('black');
  const [drawDash, setDrawDash] = useState<DashStyle>('draw');
  const [drawFill, setDrawFill] = useState<FillStyle>('none');
  const [drawSize, setDrawSize] = useState<SizeStyle>('m');
  const [selectedShapeIds, setSelectedShapeIds] = useState<ShapeId[]>([]);
  const [selectionBrush, setSelectionBrush] = useState<ScreenRect | null>(null);
  const [selectionBounds, setSelectionBounds] = useState<ScreenRect | null>(null);
  const [selectionRotationDeg, setSelectionRotationDeg] = useState(0);
  const [isMovingSelection, setIsMovingSelection] = useState(false);
  const [isResizingSelection, setIsResizingSelection] = useState(false);
  const [isRotatingSelection, setIsRotatingSelection] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isPersistenceReady, setIsPersistenceReady] = useState(!options.persistenceKey);
  const [pointerScreenPoint, setPointerScreenPoint] = useState({ x: 0, y: 0 });
  const [isPointerInsideCanvas, setIsPointerInsideCanvas] = useState(false);

  useEffect(() => {
    currentToolRef.current = currentTool;
  }, [currentTool]);

  useEffect(() => {
    onMountRef.current = options.onMount;
  }, [options.onMount]);

  useEffect(() => {
    selectedShapeIdsRef.current = selectedShapeIds;
  }, [selectedShapeIds]);

  useEffect(() => {
    selectionRotationRef.current = selectionRotationDeg;
  }, [selectionRotationDeg]);

  useEffect(() => {
    schedulePersistRef.current?.();
  }, [selectedShapeIds, currentTool, drawColor, drawDash, drawFill, drawSize]);

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

  const updatePointerPreview = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const isInside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    setIsPointerInsideCanvas(isInside);
    setPointerScreenPoint({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
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
      editor.beginHistoryEntry();
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
      editor.beginHistoryEntry();
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

    const initialTool = options.initialTool ?? 'pen';
    const editor = new Editor({
      toolDefinitions: options.toolDefinitions,
      initialToolId: initialTool,
    });
    editor.renderer.setTheme(options.theme ?? 'light');
    if (!editor.tools.hasTool(initialTool)) {
      editor.setCurrentTool('pen');
    }

    let disposed = false;
    let ignorePersistenceChanges = false;
    let disposeMount: void | (() => void);
    let persistenceDb: TsdrawLocalIndexedDb | null = null;
    let persistenceChannel: BroadcastChannel | null = null;
    let isPersisting = false;
    let needsAnotherPersist = false;
    let persistenceActive = false;
    const persistenceKey = options.persistenceKey;
    const sessionId = getOrCreateSessionId();
    const syncHistoryState = () => {
      setCanUndo(editor.canUndo());
      setCanRedo(editor.canRedo());
    };

    const activeTool = editor.getCurrentToolId();
    editorRef.current = editor;
    setCurrentToolState(activeTool);
    currentToolRef.current = activeTool;
    syncHistoryState();

    const initialStyle = editor.getCurrentDrawStyle();
    setDrawColor(initialStyle.color);
    setDrawDash(initialStyle.dash);
    setDrawFill(initialStyle.fill);
    setDrawSize(initialStyle.size);

    const resize = () => {
      const dpr = window.devicePixelRatio ?? 1;
      dprRef.current = dpr;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (!persistenceActive) {
        editor.setViewport({ x: 0, y: 0, zoom: 1 });
      }
      render();
      refreshSelectionBounds(editor);
    };

    const persistSnapshot = async () => {
      if (!persistenceDb || !persistenceKey || ignorePersistenceChanges || disposed) return;
      const snapshot = editor.getPersistenceSnapshot({
        selectedShapeIds: selectedShapeIdsRef.current,
      });
      await persistenceDb.storeSnapshot({
        records: snapshot.document.records,
        state: snapshot.state,
        history: editor.getHistorySnapshot(),
        sessionId,
      });
      if (disposed) return;
      persistenceChannel?.postMessage({
        type: 'tsdraw:persisted',
        senderSessionId: sessionId,
      });
    };

    const schedulePersist = () => {
      if (!persistenceDb || !persistenceKey || disposed) return;
      const runPersist = async () => {
        if (isPersisting) {
          needsAnotherPersist = true;
          return;
        }

        isPersisting = true;
        try {
          do {
            needsAnotherPersist = false;
            await persistSnapshot();
          } while (needsAnotherPersist && !disposed);
        } catch (error) {
          console.error('tsdraw persistence failed', error);
        } finally {
          isPersisting = false;
        }
      };

      void runPersist();
    };

    schedulePersistRef.current = schedulePersist;

    const reconcileSelectionAfterDocumentLoad = () => {
      const nextSelectedShapeIds = selectedShapeIdsRef.current.filter((shapeId) => editor.getShape(shapeId) != null);
      if (nextSelectedShapeIds.length !== selectedShapeIdsRef.current.length) {
        selectedShapeIdsRef.current = nextSelectedShapeIds;
        setSelectedShapeIds(nextSelectedShapeIds);
      }
      refreshSelectionBounds(editor, nextSelectedShapeIds);
    };

    const applyRemoteDocumentSnapshot = (document: TsdrawDocumentSnapshot) => {
      ignorePersistenceChanges = true;
      editor.loadDocumentSnapshot(document);
      editor.clearRedoHistory();
      reconcileSelectionAfterDocumentLoad();
      render();
      ignorePersistenceChanges = false;
    };

    const applyLoadedSnapshot = (snapshot: Partial<TsdrawEditorSnapshot>) => {
      ignorePersistenceChanges = true;
      const nextSelectionIds = editor.loadPersistenceSnapshot(snapshot);
      setSelectedShapeIds(nextSelectionIds);
      selectedShapeIdsRef.current = nextSelectionIds;
      const nextTool = editor.getCurrentToolId();
      currentToolRef.current = nextTool;
      setCurrentToolState(nextTool);
      const nextDrawStyle = editor.getCurrentDrawStyle();
      setDrawColor(nextDrawStyle.color);
      setDrawDash(nextDrawStyle.dash);
      setDrawFill(nextDrawStyle.fill);
      setDrawSize(nextDrawStyle.size);
      setSelectionRotationDeg(0);
      render();
      refreshSelectionBounds(editor, nextSelectionIds);
      ignorePersistenceChanges = false;
    };

    const getPagePoint = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return editor.screenToPage(e.clientX - rect.left, e.clientY - rect.top);
    };

    const sampleEvents = (e: PointerEvent) => {
      const coalesced = e.getCoalescedEvents?.();
      return coalesced && coalesced.length > 0 ? coalesced : [e];
    };

    const applyDocumentChangeResult = (changed: boolean) => {
      if (!changed) return false;
      reconcileSelectionAfterDocumentLoad();
      setSelectionRotationDeg(0);
      render();
      syncHistoryState();
      return true;
    };

    const normalizeWheelDelta = (event: WheelEvent) => {
      let deltaX = event.deltaX;
      let deltaY = event.deltaY;
      let deltaZoom = 0;
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const clamped = Math.abs(deltaY) > ZOOM_WHEEL_CAP ? ZOOM_WHEEL_CAP * Math.sign(deltaY) : deltaY;
        deltaZoom = -clamped / 100;
      } else if (event.shiftKey && !navigator.userAgent.includes('Mac') && !navigator.userAgent.includes('iPhone') && !navigator.userAgent.includes('iPad')) {
        deltaX = deltaY;
        deltaY = 0;
      }
      return { x: -deltaX, y: -deltaY, z: deltaZoom };
    };

    const deleteCurrentSelection = () => {
      const selectedIds = selectedShapeIdsRef.current;
      if (selectedIds.length === 0) return false;
      editor.beginHistoryEntry();
      editor.deleteShapes(selectedIds);
      editor.endHistoryEntry();
      setSelectedShapeIds([]);
      selectedShapeIdsRef.current = [];
      setSelectionBounds(null);
      setSelectionBrush(null);
      setSelectionRotationDeg(0);
      render();
      syncHistoryState();
      return true;
    };

    const cancelActivePointerInteraction = () => {
      if (!isPointerActiveRef.current) return;
      isPointerActiveRef.current = false;
      lastPointerClientRef.current = null;
      editor.input.pointerUp();
      if (currentToolRef.current === 'select') {
        const dragMode = selectDragRef.current.mode;
        if (dragMode === 'rotate') setIsRotatingSelection(false);
        if (dragMode === 'resize') setIsResizingSelection(false);
        if (dragMode === 'move') setIsMovingSelection(false);
        if (dragMode === 'marquee') setSelectionBrush(null);
        selectDragRef.current.mode = 'none';
      } else {
        editor.tools.pointerUp();
      }
      editor.endHistoryEntry();
      render();
      refreshSelectionBounds(editor);
    };
    const touchInteractions = createTouchInteractionController(editor, canvas, {
      cancelActivePointerInteraction,
      refreshView: () => {
        render();
        refreshSelectionBounds(editor);
      },
      runUndo: () => applyDocumentChangeResult(editor.undo()),
      runRedo: () => applyDocumentChangeResult(editor.redo()),
    });

    const isDrawingTool = (tool: ToolId) => tool !== 'select' && tool !== 'hand';
    const hasRealPressure = (pressure: number | undefined) => pressure != null && pressure > 0 && pressure !== 0.5;

    const handlePointerDown = (e: PointerEvent) => {
      if (!canvas.contains(e.target as Node)) return;

      if (!penDetectedRef.current && (e.pointerType === 'pen' || hasRealPressure(e.pressure))) {
        penDetectedRef.current = true;
        penModeRef.current = true;
      }
      lastPointerDownWithRef.current = e.pointerType as 'mouse' | 'touch' | 'pen';
      activePointerIdsRef.current.add(e.pointerId);

      const startedCameraGesture = touchInteractions.handlePointerDown(e);
      if (startedCameraGesture || touchInteractions.isCameraGestureActive()) {
        e.preventDefault();
        if (!canvas.hasPointerCapture(e.pointerId)) {
          canvas.setPointerCapture(e.pointerId);
        }
        return;
      }

      const allowPointerDown = !penModeRef.current || e.pointerType !== 'touch' || !isDrawingTool(currentToolRef.current);

      if (!allowPointerDown) { return; }
      if (activePointerIdsRef.current.size > 1) { return; }

      isPointerActiveRef.current = true;
      editor.beginHistoryEntry();
      canvas.setPointerCapture(e.pointerId);
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
      updatePointerPreview(e.clientX, e.clientY);

      const first = sampleEvents(e)[0]!;
      const { x, y } = getPagePoint(first);
      const pressure = first.pressure ?? 0.5;
      const isPen = first.pointerType === 'pen' || hasRealPressure(first.pressure);

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
        setSelectionBrush(toScreenRect(editor, { minX: x, minY: y, maxX: x, maxY: y }));
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
      if (!penDetectedRef.current && (e.pointerType === 'pen' || hasRealPressure(e.pressure))) {
        penDetectedRef.current = true;
        penModeRef.current = true;
      }
      if (touchInteractions.handlePointerMove(e)) {
        e.preventDefault();
        return;
      }
      if (penModeRef.current && e.pointerType === 'touch' && isDrawingTool(currentToolRef.current) && !isPointerActiveRef.current) return;
      if (activePointerIdsRef.current.size > 1) return;
      updatePointerPreview(e.clientX, e.clientY);
      const prevClient = lastPointerClientRef.current;
      const dx = prevClient ? e.clientX - prevClient.x : 0;
      const dy = prevClient ? e.clientY - prevClient.y : 0;
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };

      for (const sample of sampleEvents(e)) {
        const { x, y } = getPagePoint(sample);
        const pressure = sample.pressure ?? 0.5;
        const isPen = sample.pointerType === 'pen' || hasRealPressure(sample.pressure);
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
      activePointerIdsRef.current.delete(e.pointerId);
      const hadTouchCameraGesture = touchInteractions.handlePointerUpOrCancel(e);
      if (hadTouchCameraGesture || touchInteractions.isCameraGestureActive()) {
        e.preventDefault();
        return;
      }
      if (!isPointerActiveRef.current) return;
      isPointerActiveRef.current = false;
      lastPointerClientRef.current = null;
      updatePointerPreview(e.clientX, e.clientY);
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
          editor.endHistoryEntry();
          return;
        }

        if (drag.mode === 'resize') {
          setIsResizingSelection(false);
          selectDragRef.current.mode = 'none';
          resizeRef.current = { handle: null, startBounds: null, startShapes: new Map() };
          render();
          refreshSelectionBounds(editor);
          editor.endHistoryEntry();
          return;
        }

        if (drag.mode === 'move') {
          setIsMovingSelection(false);
          selectDragRef.current.mode = 'none';
          render();
          refreshSelectionBounds(editor);
          editor.endHistoryEntry();
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
          if (pendingRemoteDocumentRef.current) {
            const pendingRemoteDocument = pendingRemoteDocumentRef.current;
            pendingRemoteDocumentRef.current = null;
            applyRemoteDocumentSnapshot(pendingRemoteDocument);
          }
          editor.endHistoryEntry();
          return;
        }
      }

      editor.tools.pointerUp();
      render();
      refreshSelectionBounds(editor);
      if (pendingRemoteDocumentRef.current) {
        const pendingRemoteDocument = pendingRemoteDocumentRef.current;
        pendingRemoteDocumentRef.current = null;
        applyRemoteDocumentSnapshot(pendingRemoteDocument);
      }
      editor.endHistoryEntry();
    };

    const handlePointerCancel = (e: PointerEvent) => {
      activePointerIdsRef.current.delete(e.pointerId);
      const hadTouchCameraGesture = touchInteractions.handlePointerUpOrCancel(e);
      if (hadTouchCameraGesture || touchInteractions.isCameraGestureActive()) return;
      if (!isPointerActiveRef.current) return;
      isPointerActiveRef.current = false;
      lastPointerClientRef.current = null;
      editor.input.pointerUp();

      if (currentToolRef.current === 'select') {
        const drag = selectDragRef.current;
        if (drag.mode === 'rotate') setIsRotatingSelection(false);
        if (drag.mode === 'resize') setIsResizingSelection(false);
        if (drag.mode === 'move') setIsMovingSelection(false);
        if (drag.mode === 'marquee') setSelectionBrush(null);
        if (drag.mode !== 'none') {
          selectDragRef.current.mode = 'none';
          render();
          refreshSelectionBounds(editor);
        }
        editor.endHistoryEntry();
      } else {
        editor.tools.pointerUp();
        render();
        refreshSelectionBounds(editor);
        editor.endHistoryEntry();
      }

      if (pendingRemoteDocumentRef.current) {
        const pending = pendingRemoteDocumentRef.current;
        pendingRemoteDocumentRef.current = null;
        applyRemoteDocumentSnapshot(pending);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!container.contains(e.target as Node)) return;
      e.preventDefault();
      if (touchInteractions.isTrackpadZoomActive()) return;
      const delta = normalizeWheelDelta(e);
      if (delta.z !== 0) {
        const rect = canvas.getBoundingClientRect();
        const pointX = e.clientX - rect.left;
        const pointY = e.clientY - rect.top;
        editor.zoomAt(Math.exp(delta.z), pointX, pointY);
      } else {
        editor.panBy(delta.x, delta.y);
      }
      render();
      refreshSelectionBounds(editor);
    };

    const handleGestureEvent = (e: Event) => {
      touchInteractions.handleGestureEvent(e, container);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      handleKeyboardShortcutKeyDown(e, {
        isToolAvailable: (tool) => editor.tools.hasTool(tool),
        setToolFromShortcut: (tool) => {
          editor.setCurrentTool(tool);
          setCurrentToolState(tool);
          currentToolRef.current = tool;
          if (tool !== 'select') resetSelectUi();
          render();
        },
        runHistoryShortcut: (shouldRedo) => applyDocumentChangeResult(shouldRedo ? editor.redo() : editor.undo()),
        deleteSelection: () => (currentToolRef.current === 'select' ? deleteCurrentSelection() : false),
        dispatchKeyDown: (event) => {
          editor.input.setModifiers(event.shiftKey, event.ctrlKey, event.metaKey);
          editor.tools.keyDown({ key: event.key });
          render();
        },
        dispatchKeyUp: () => undefined,
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      handleKeyboardShortcutKeyUp(e, {
        isToolAvailable: () => false,
        setToolFromShortcut: () => undefined,
        runHistoryShortcut: () => false,
        deleteSelection: () => false,
        dispatchKeyDown: () => undefined,
        dispatchKeyUp: (event) => {
          editor.input.setModifiers(event.shiftKey, event.ctrlKey, event.metaKey);
          editor.tools.keyUp({ key: event.key });
          render();
        },
      });
    };

    const initializePersistence = async () => {
      if (!persistenceKey) { setIsPersistenceReady(true); return; }

      try {
        persistenceDb = new TsdrawLocalIndexedDb(persistenceKey);
        const loaded = await persistenceDb.load(sessionId);
        const snapshot: Partial<TsdrawEditorSnapshot> = {};
        if (loaded.records.length > 0) {
          snapshot.document = { records: loaded.records };
        }
        if (loaded.state) {
          snapshot.state = loaded.state;
        }
        if (snapshot.document || snapshot.state) {
          applyLoadedSnapshot(snapshot);
        }
        editor.loadHistorySnapshot(loaded.history);
        syncHistoryState();

        if (disposed) return;
        persistenceActive = true;
        if (typeof BroadcastChannel !== 'undefined') {
          persistenceChannel = new BroadcastChannel(`tsdraw:persistence:${persistenceKey}`);
          let isLoadingRemote = false;
          let pendingRemoteLoad = false;
          persistenceChannel.onmessage = () => {
            if (disposed) return;
            if (isLoadingRemote) {
              pendingRemoteLoad = true;
              return;
            }
            isLoadingRemote = true;
            const processLoad = async () => {
              try {
                do {
                  pendingRemoteLoad = false;
                  if (!persistenceDb || disposed) return;
                  const nextLoaded = await persistenceDb.load(sessionId);
                  if (disposed) return;
                  if (nextLoaded.records.length > 0) {
                    const nextDocument: TsdrawDocumentSnapshot = { records: nextLoaded.records };
                    if (isPointerActiveRef.current) {
                      pendingRemoteDocumentRef.current = nextDocument;
                      return;
                    }
                    applyRemoteDocumentSnapshot(nextDocument);
                  }
                } while (pendingRemoteLoad && !disposed);
              } finally {
                isLoadingRemote = false;
              }
            };
            void processLoad();
          };
        }
      } finally {
        if (!disposed) { setIsPersistenceReady(true); }
      }
    };

    const cleanupEditorListener = editor.listen(() => {
      if (ignorePersistenceChanges) return;
      schedulePersist();
    });
    const cleanupHistoryListener = editor.listenHistory(() => {
      syncHistoryState();
      if (ignorePersistenceChanges) return;
      schedulePersist();
    });

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    canvas.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('gesturestart', handleGestureEvent);
    document.addEventListener('gesturechange', handleGestureEvent);
    document.addEventListener('gestureend', handleGestureEvent);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    void initializePersistence().catch((error) => {
      console.error('failed to initialize tsdraw persistence', error);
    });

    disposeMount = onMountRef.current?.({
      editor,
      container,
      canvas,
      setTool: (tool) => {
        if (!editor.tools.hasTool(tool)) return;
        editor.setCurrentTool(tool);
        setCurrentToolState(tool);
        currentToolRef.current = tool;
      },
      getCurrentTool: () => editor.getCurrentToolId(),
      undo: () => {
        const changed = editor.undo();
        if (!changed) return false;
        reconcileSelectionAfterDocumentLoad();
        setSelectionRotationDeg(0);
        render();
        syncHistoryState();
        return true;
      },
      redo: () => {
        const changed = editor.redo();
        if (!changed) return false;
        reconcileSelectionAfterDocumentLoad();
        setSelectionRotationDeg(0);
        render();
        syncHistoryState();
        return true;
      },
      canUndo: () => editor.canUndo(),
      canRedo: () => editor.canRedo(),
      applyDrawStyle: (partial) => {
        editor.setCurrentDrawStyle(partial);
        if (partial.color) setDrawColor(partial.color);
        if (partial.dash) setDrawDash(partial.dash);
        if (partial.fill) setDrawFill(partial.fill);
        if (partial.size) setDrawSize(partial.size);
        render();
      },
    });

    return () => {
      disposed = true;
      schedulePersistRef.current = null;
      cleanupEditorListener();
      cleanupHistoryListener();
      disposeMount?.();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('wheel', handleWheel);
      document.removeEventListener('gesturestart', handleGestureEvent);
      document.removeEventListener('gesturechange', handleGestureEvent);
      document.removeEventListener('gestureend', handleGestureEvent);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      isPointerActiveRef.current = false;
      activePointerIdsRef.current.clear();
      pendingRemoteDocumentRef.current = null;
      touchInteractions.reset();
      persistenceChannel?.close();
      void persistenceDb?.close();
      editorRef.current = null;
    };
  }, [
    getPagePointFromClient,
    options.initialTool,
    options.persistenceKey,
    options.toolDefinitions,
    refreshSelectionBounds,
    resetSelectUi,
    render,
    updatePointerPreview,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.renderer.setTheme(options.theme ?? 'light');
    render();
  }, [options.theme, render]);

  const setTool = useCallback(
    (tool: ToolId) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (!editor.tools.hasTool(tool)) return;
      editor.setCurrentTool(tool);
      setCurrentToolState(tool);
      currentToolRef.current = tool;
      if (tool !== 'select') resetSelectUi();
    },
    [resetSelectUi]
  );

  const applyDrawStyle = useCallback(
    (partial: Partial<{ color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle }>) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.setCurrentDrawStyle(partial);
      if (partial.color) setDrawColor(partial.color);
      if (partial.dash) setDrawDash(partial.dash);
      if (partial.fill) setDrawFill(partial.fill);
      if (partial.size) setDrawSize(partial.size);
      render();
    },
    [render]
  );

  const undo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return false;
    const changed = editor.undo();
    if (!changed) return false;
    const nextSelectedShapeIds = selectedShapeIdsRef.current.filter((shapeId) => editor.getShape(shapeId) != null);
    if (nextSelectedShapeIds.length !== selectedShapeIdsRef.current.length) {
      selectedShapeIdsRef.current = nextSelectedShapeIds;
      setSelectedShapeIds(nextSelectedShapeIds);
    }
    setSelectionRotationDeg(0);
    render();
    setCanUndo(editor.canUndo());
    setCanRedo(editor.canRedo());
    return true;
  }, [render]);

  const redo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return false;
    const changed = editor.redo();
    if (!changed) return false;
    const nextSelectedShapeIds = selectedShapeIdsRef.current.filter((shapeId) => editor.getShape(shapeId) != null);
    if (nextSelectedShapeIds.length !== selectedShapeIdsRef.current.length) {
      selectedShapeIdsRef.current = nextSelectedShapeIds;
      setSelectedShapeIds(nextSelectedShapeIds);
    }
    setSelectionRotationDeg(0);
    render();
    setCanUndo(editor.canUndo());
    setCanRedo(editor.canRedo());
    return true;
  }, [render]);

  const showToolOverlay = isPointerInsideCanvas && (currentTool === 'pen' || currentTool === 'eraser');
  const canvasCursor = getCanvasCursor(currentTool, {
    isMovingSelection,
    isResizingSelection,
    isRotatingSelection,
    showToolOverlay,
  });
  const cursorContext: TsdrawCursorContext = {
    currentTool,
    defaultCursor: canvasCursor,
    showToolOverlay,
    isMovingSelection,
    isResizingSelection,
    isRotatingSelection,
  };
  const toolOverlay: TsdrawToolOverlayState = {
    visible: showToolOverlay,
    pointerX: pointerScreenPoint.x,
    pointerY: pointerScreenPoint.y,
    isPenPreview: currentTool === 'pen',
    penRadius: Math.max(2, STROKE_WIDTHS[drawSize] / 2),
    penColor: resolveDrawColor(drawColor, options.theme ?? 'light'),
    eraserRadius: ERASER_MARGIN,
  };

  return {
    containerRef,
    canvasRef,
    currentTool,
    drawColor,
    drawDash,
    drawFill,
    drawSize,
    selectedShapeIds,
    selectionBrush,
    selectionBounds,
    selectionRotationDeg,
    canvasCursor,
    cursorContext,
    toolOverlay,
    isPersistenceReady,
    canUndo,
    canRedo,
    undo,
    redo,
    setTool,
    applyDrawStyle,
    handleResizePointerDown,
    handleRotatePointerDown,
  };
}
