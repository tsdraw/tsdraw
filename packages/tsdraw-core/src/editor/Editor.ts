import { DocumentStore } from '../store/documentStore.js';
import type { Viewport, ZoomRange } from '../canvas/viewport.js';
import { createViewport, screenToPage, zoomViewport, clampZoom } from '../canvas/viewport.js';
import { CanvasRenderer } from '../canvas/renderer.js';
import { InputManager } from '../input/inputManager.js';
import type { ToolStateContext } from '../store/stateNode.js';
import { ToolManager, type ToolDefinition, type ToolId } from '../tools/toolManager.js';
import { PenIdleState } from '../tools/pen/states/PenIdleState.js';
import { PenDrawingState } from '../tools/pen/states/PenDrawingState.js';
import { SquareIdleState } from '../tools/square/states/SquareIdleState.js';
import { SquareDrawingState } from '../tools/square/states/SquareDrawingState.js';
import { CircleIdleState } from '../tools/circle/states/CircleIdleState.js';
import { CircleDrawingState } from '../tools/circle/states/CircleDrawingState.js';
import { EraserIdleState } from '../tools/eraser/states/EraserIdleState.js';
import { EraserPointingState } from '../tools/eraser/states/EraserPointingState.js';
import { EraserErasingState } from '../tools/eraser/states/EraserErasingState.js';
import { SelectIdleState } from '../tools/select/states/SelectIdleState.js';
import { HandIdleState } from '../tools/hand/states/HandIdleState.js';
import { HandDraggingState } from '../tools/hand/states/HandDraggingState.js';
import { PenRecognizingState } from '../tools/pen/states/PenRecognizingState.js';
import type { ShapeId, Shape, DrawShape, ColorStyle, DashStyle, SizeStyle, FillStyle } from '../types.js';
import type { Vec3 } from '../types.js';
import { DRAG_DISTANCE_SQUARED } from '../types.js';
import {
  documentSnapshotToRecords,
  recordsToDocumentSnapshot,
  type TsdrawDocumentSnapshot,
  type TsdrawEditorSnapshot,
  type TsdrawHistorySnapshot,
  type TsdrawSessionStateSnapshot,
} from '../persistence/snapshots.js';

export interface EditorOptions {
  dragDistanceSquared?: number;
  toolDefinitions?: ToolDefinition[];
  initialToolId?: ToolId;
  zoomRange?: ZoomRange;
}

type EditorListener = () => void;

let shapeIdCounter = 0;
const shapeIdRuntimeSeed = Math.random().toString(36).slice(2, 8);
const MAX_HISTORY_ENTRIES = 100;

function createShapeId(): ShapeId {
  shapeIdCounter += 1;
  return `shape:${Date.now().toString(36)}-${shapeIdRuntimeSeed}-${shapeIdCounter.toString(36)}`;
}

function cloneDocumentSnapshot(snapshot: TsdrawDocumentSnapshot): TsdrawDocumentSnapshot {
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot);
  }
  return JSON.parse(JSON.stringify(snapshot)) as TsdrawDocumentSnapshot;
}

function areDocumentSnapshotsEqual(left: TsdrawDocumentSnapshot, right: TsdrawDocumentSnapshot): boolean {
  if (left.records.length !== right.records.length) return false;
  for (let i = 0; i < left.records.length; i += 1) {
    if (JSON.stringify(left.records[i]) !== JSON.stringify(right.records[i])) {
      return false;
    }
  }
  return true;
}

// Main editor: document store, viewport, input, tools, renderer
export class Editor {
  readonly store: DocumentStore = new DocumentStore();
  readonly input: InputManager = new InputManager();
  readonly tools: ToolManager = new ToolManager();
  readonly renderer: CanvasRenderer = new CanvasRenderer();
  viewport: Viewport = createViewport();
  readonly options: { dragDistanceSquared: number; zoomRange?: ZoomRange };
  // Default draw style
  private drawStyle: { color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle } = {
    color: 'black',
    dash: 'draw',
    fill: 'none',
    size: 'm',
  };
  private readonly toolStateContext: ToolStateContext;
  private readonly listeners = new Set<EditorListener>();
  private readonly historyListeners = new Set<EditorListener>();
  private readonly renderCallbacks = new Set<EditorListener>();
  private undoStack: TsdrawDocumentSnapshot[] = [];
  private redoStack: TsdrawDocumentSnapshot[] = [];
  private lastDocumentSnapshot: TsdrawDocumentSnapshot;
  private suppressHistoryCapture = false;
  private historyBatchDepth = 0;
  private historyBatchStartSnapshot: TsdrawDocumentSnapshot | null = null;
  private historyBatchChanged = false;

  // Creates a new editor instance with the given options (with defaults if not provided)
  constructor(opts: EditorOptions = {}) {
    this.options = { dragDistanceSquared: opts.dragDistanceSquared ?? DRAG_DISTANCE_SQUARED, zoomRange: opts.zoomRange };
    this.lastDocumentSnapshot = this.getDocumentSnapshot();
    this.store.listen(() => {
      this.captureDocumentHistory();
      this.emitChange();
    });
    this.toolStateContext = {
      transition: (id, info) => this.tools.transition(id, info),
    };
    for (const defaultTool of this.getDefaultToolDefinitions()) {
      this.registerToolDefinition(defaultTool);
    }
    for (const customTool of opts.toolDefinitions ?? []) {
      this.registerToolDefinition(customTool);
    }
    this.setCurrentTool(opts.initialToolId ?? 'pen');
    this.lastDocumentSnapshot = this.getDocumentSnapshot();
  }

  private captureDocumentHistory(): void {
    const nextSnapshot = this.getDocumentSnapshot();
    const previousSnapshot = this.lastDocumentSnapshot;
    this.lastDocumentSnapshot = nextSnapshot;

    if (this.suppressHistoryCapture || areDocumentSnapshotsEqual(previousSnapshot, nextSnapshot)) {
      return;
    }

    if (this.historyBatchDepth > 0) {
      this.historyBatchChanged = true;
      return;
    }

    this.undoStack.push(cloneDocumentSnapshot(previousSnapshot));
    if (this.undoStack.length > MAX_HISTORY_ENTRIES) {
      this.undoStack.splice(0, this.undoStack.length - MAX_HISTORY_ENTRIES);
    }
    this.redoStack = [];
    this.emitHistoryChange();
  }

  registerToolDefinition(toolDefinition: ToolDefinition): void {
    for (const stateConstructor of toolDefinition.stateConstructors) {
      this.tools.registerState(new stateConstructor(this.toolStateContext, this));
    }
    this.tools.registerTool(toolDefinition.id, toolDefinition.initialStateId);
  }

  private getDefaultToolDefinitions(): ToolDefinition[] {
    return [
      { id: 'pen', initialStateId: PenIdleState.id, stateConstructors: [PenIdleState, PenDrawingState, PenRecognizingState] },
      { id: 'square', initialStateId: SquareIdleState.id, stateConstructors: [SquareIdleState, SquareDrawingState] },
      { id: 'circle', initialStateId: CircleIdleState.id, stateConstructors: [CircleIdleState, CircleDrawingState] },
      { id: 'eraser', initialStateId: EraserIdleState.id, stateConstructors: [EraserIdleState, EraserPointingState, EraserErasingState] },
      { id: 'select', initialStateId: SelectIdleState.id, stateConstructors: [SelectIdleState] },
      { id: 'hand', initialStateId: HandIdleState.id, stateConstructors: [HandIdleState, HandDraggingState] },
    ];
  }

  createShapeId(): ShapeId { return createShapeId(); }
  getZoomLevel(): number { return this.viewport.zoom; }
  getShape(id: ShapeId): Shape | undefined { return this.store.getShape(id); }
  createShape(shape: Shape): void { this.store.createShape(shape); }

  updateShapes(
    partials: Array<{ id: ShapeId; type: string; props?: Partial<DrawShape['props']> }>
  ): void {
    for (const p of partials) {
      const existing = this.store.getShape(p.id) as DrawShape | undefined;
      if (existing && p.props) {
        this.store.updateShape(p.id, { props: { ...existing.props, ...p.props } });
      }
    }
  }

  // Page point to shape local point (for draw shapes: subtract shape pos)
  getPointInShapeSpace(shape: DrawShape, pagePoint: Vec3): Vec3 {
    return {
      x: pagePoint.x - shape.x,
      y: pagePoint.y - shape.y,
      z: pagePoint.z,
    };
  }

  getCurrentPageShapes() { return this.store.getCurrentPageShapes(); }
  getCurrentPageShapesSorted() { return this.store.getCurrentPageShapesSorted(); }
  getCurrentPageRenderingShapesSorted() { return this.store.getCurrentPageRenderingShapesSorted(); }

  getErasingShapeIds() { return this.store.getErasingShapeIds(); }
  setErasingShapes(ids: ShapeId[]) { this.store.setErasingShapes(ids); }

  setCurrentTool(id: ToolId) { this.tools.setCurrentTool(id); this.emitChange(); }
  getCurrentToolId(): ToolId { return this.tools.getCurrentToolId(); }

  getCurrentDrawStyle() { return { ...this.drawStyle }; }
  setCurrentDrawStyle(partial: Partial<{ color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle }>) {
    this.drawStyle = { ...this.drawStyle, ...partial };
    this.emitChange();
  }

  setViewport(partial: Partial<Viewport>) {
    const rawZoom = partial.zoom ?? this.viewport.zoom;
    this.viewport = {
      x: partial.x ?? this.viewport.x,
      y: partial.y ?? this.viewport.y,
      zoom: clampZoom(rawZoom, this.options.zoomRange),
    };
    this.emitChange();
  }

  panBy(dx: number, dy: number) {
    this.setViewport({
      x: this.viewport.x + dx,
      y: this.viewport.y + dy,
    });
  }

  zoomAt(factor: number, screenX: number, screenY: number): void {
    this.viewport = zoomViewport(this.viewport, factor, screenX, screenY, this.options.zoomRange);
    this.emitChange();
  }

  deleteShapes(ids: ShapeId[]): void {
    if (ids.length === 0) return;
    this.store.deleteShapes(ids);
  }

  getDocumentSnapshot(): TsdrawDocumentSnapshot {
    return {
      records: documentSnapshotToRecords(this.store.getSnapshot()),
    };
  }

  loadDocumentSnapshot(snapshot: TsdrawDocumentSnapshot): void {
    const documentSnapshot = recordsToDocumentSnapshot(snapshot.records);
    if (!documentSnapshot) return;
    this.runWithoutHistoryCapture(() => { this.store.loadSnapshot(documentSnapshot) });
  }

  getSessionStateSnapshot(args?: { selectedShapeIds?: ShapeId[] }): TsdrawSessionStateSnapshot {
    return {
      version: 1,
      viewport: {
        x: this.viewport.x,
        y: this.viewport.y,
        zoom: this.viewport.zoom,
      },
      currentToolId: this.getCurrentToolId(),
      drawStyle: this.getCurrentDrawStyle(),
      selectedShapeIds: [...(args?.selectedShapeIds ?? [])],
    };
  }

  loadSessionStateSnapshot(snapshot: TsdrawSessionStateSnapshot): ShapeId[] {
    this.setViewport(snapshot.viewport);
    this.setCurrentDrawStyle({
      color: snapshot.drawStyle.color,
      dash: snapshot.drawStyle.dash,
      fill: snapshot.drawStyle.fill ?? 'none',
      size: snapshot.drawStyle.size,
    });
    if (this.tools.hasTool(snapshot.currentToolId)) {
      this.setCurrentTool(snapshot.currentToolId);
    }
    return [...snapshot.selectedShapeIds];
  }

  getPersistenceSnapshot(args?: { selectedShapeIds?: ShapeId[] }): TsdrawEditorSnapshot {
    return {
      document: this.getDocumentSnapshot(),
      state: this.getSessionStateSnapshot(args),
    };
  }

  loadPersistenceSnapshot(snapshot: Partial<TsdrawEditorSnapshot>): ShapeId[] {
    if (snapshot.document) {
      this.loadDocumentSnapshot(snapshot.document);
    }
    if (snapshot.state) {
      return this.loadSessionStateSnapshot(snapshot.state);
    }
    return [];
  }

  getHistorySnapshot(): TsdrawHistorySnapshot {
    return {
      version: 1,
      undoStack: this.undoStack.map(cloneDocumentSnapshot),
      redoStack: this.redoStack.map(cloneDocumentSnapshot),
    };
  }

  loadHistorySnapshot(snapshot: TsdrawHistorySnapshot | null | undefined): void {
    if (!snapshot || snapshot.version !== 1) return;
    this.undoStack = snapshot.undoStack.map(cloneDocumentSnapshot).slice(-MAX_HISTORY_ENTRIES);
    this.redoStack = snapshot.redoStack.map(cloneDocumentSnapshot).slice(-MAX_HISTORY_ENTRIES);
    this.emitHistoryChange();
  }

  clearRedoHistory(): void {
    if (this.redoStack.length === 0) return;
    this.redoStack = [];
    this.emitHistoryChange();
  }

  beginHistoryEntry(): void {
    if (this.historyBatchDepth === 0) {
      this.historyBatchStartSnapshot = cloneDocumentSnapshot(this.lastDocumentSnapshot);
      this.historyBatchChanged = false;
    }
    this.historyBatchDepth += 1;
  }

  endHistoryEntry(): void {
    if (this.historyBatchDepth === 0) return;
    this.historyBatchDepth -= 1;
    if (this.historyBatchDepth > 0) return;

    const startSnapshot = this.historyBatchStartSnapshot;
    this.historyBatchStartSnapshot = null;
    if (!startSnapshot) return;

    const endSnapshot = this.getDocumentSnapshot();
    this.lastDocumentSnapshot = endSnapshot;
    const didDocumentChange = this.historyBatchChanged || !areDocumentSnapshotsEqual(startSnapshot, endSnapshot);
    this.historyBatchChanged = false;
    if (!didDocumentChange) return;

    this.undoStack.push(cloneDocumentSnapshot(startSnapshot));
    if (this.undoStack.length > MAX_HISTORY_ENTRIES) {
      this.undoStack.splice(0, this.undoStack.length - MAX_HISTORY_ENTRIES);
    }
    this.redoStack = [];
    this.emitHistoryChange();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const previousSnapshot = this.undoStack.pop();
    if (!previousSnapshot) return false;

    const currentSnapshot = this.getDocumentSnapshot();
    this.redoStack.push(cloneDocumentSnapshot(currentSnapshot));
    if (this.redoStack.length > MAX_HISTORY_ENTRIES) {
      this.redoStack.splice(0, this.redoStack.length - MAX_HISTORY_ENTRIES);
    }

    this.loadDocumentSnapshot(previousSnapshot);
    this.emitHistoryChange();
    return true;
  }

  redo(): boolean {
    const nextSnapshot = this.redoStack.pop();
    if (!nextSnapshot) return false;

    const currentSnapshot = this.getDocumentSnapshot();
    this.undoStack.push(cloneDocumentSnapshot(currentSnapshot));
    if (this.undoStack.length > MAX_HISTORY_ENTRIES) {
      this.undoStack.splice(0, this.undoStack.length - MAX_HISTORY_ENTRIES);
    }

    this.loadDocumentSnapshot(nextSnapshot);
    this.emitHistoryChange();
    return true;
  }

  listen(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listenHistory(listener: EditorListener): () => void {
    this.historyListeners.add(listener);
    return () => {
      this.historyListeners.delete(listener);
    };
  }

  onRequestRender(callback: EditorListener): () => void {
    this.renderCallbacks.add(callback);
    return () => { this.renderCallbacks.delete(callback); };
  }

  requestRender(): void {
    for (const cb of this.renderCallbacks) cb();
  }

  // Convert screen coords to page coords
  screenToPage(screenX: number, screenY: number): { x: number; y: number } {
    return screenToPage(this.viewport, screenX, screenY);
  }

  // Render current page to 2d canvas context
  render(ctx: CanvasRenderingContext2D) {
    const shapes = this.getCurrentPageShapesSorted();
    const erasingIds = new Set(this.getErasingShapeIds());
    const visible = shapes.filter((s) => !erasingIds.has(s.id));
    this.renderer.render(ctx, this.viewport, visible);
  }

  private emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private emitHistoryChange() {
    for (const listener of this.historyListeners) {
      listener();
    }
  }

  private runWithoutHistoryCapture(fn: () => void): void {
    const previousValue = this.suppressHistoryCapture;
    this.suppressHistoryCapture = true;
    try {
      fn();
    } finally {
      this.suppressHistoryCapture = previousValue;
      this.lastDocumentSnapshot = this.getDocumentSnapshot();
    }
  }
}
