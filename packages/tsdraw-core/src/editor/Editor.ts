import { DocumentStore } from '../store/documentStore.js';
import type { Viewport } from '../canvas/viewport.js';
import { createViewport, screenToPage } from '../canvas/viewport.js';
import { CanvasRenderer } from '../canvas/renderer.js';
import { InputManager } from '../input/inputManager.js';
import type { ToolStateContext } from '../store/stateNode.js';
import { ToolManager, type ToolDefinition, type ToolId } from '../tools/toolManager.js';
import { PenIdleState } from '../tools/pen/states/PenIdleState.js';
import { PenDrawingState } from '../tools/pen/states/PenDrawingState.js';
import { EraserIdleState } from '../tools/eraser/states/EraserIdleState.js';
import { EraserPointingState } from '../tools/eraser/states/EraserPointingState.js';
import { EraserErasingState } from '../tools/eraser/states/EraserErasingState.js';
import { SelectIdleState } from '../tools/select/states/SelectIdleState.js';
import { HandIdleState } from '../tools/hand/states/HandIdleState.js';
import { HandDraggingState } from '../tools/hand/states/HandDraggingState.js';
import type { ShapeId, Shape, DrawShape, ColorStyle, DashStyle, SizeStyle } from '../types.js';
import type { Vec3 } from '../types.js';
import { DRAG_DISTANCE_SQUARED } from '../types.js';
import {
  documentSnapshotToRecords,
  recordsToDocumentSnapshot,
  type TsdrawDocumentSnapshot,
  type TsdrawEditorSnapshot,
  type TsdrawSessionStateSnapshot,
} from '../persistence/snapshots.js';

export interface EditorOptions {
  dragDistanceSquared?: number;
  toolDefinitions?: ToolDefinition[];
  initialToolId?: ToolId;
}

type EditorListener = () => void;

let shapeIdCounter = 0;
const shapeIdRuntimeSeed = Math.random().toString(36).slice(2, 8);
function createShapeId(): ShapeId {
  shapeIdCounter += 1;
  return `shape:${Date.now().toString(36)}-${shapeIdRuntimeSeed}-${shapeIdCounter.toString(36)}`;
}

// Main editor: document store, viewport, input, tools, renderer
export class Editor {
  readonly store: DocumentStore = new DocumentStore();
  readonly input: InputManager = new InputManager();
  readonly tools: ToolManager = new ToolManager();
  readonly renderer: CanvasRenderer = new CanvasRenderer();
  viewport: Viewport = createViewport();
  readonly options: { dragDistanceSquared: number };
  // Default draw style
  private drawStyle: { color: ColorStyle; dash: DashStyle; size: SizeStyle } = {
    color: 'black',
    dash: 'draw',
    size: 'm',
  };
  private readonly toolStateContext: ToolStateContext;
  private readonly listeners = new Set<EditorListener>();

  // Creates a new editor instance with the given options (with defaults if not provided)
  constructor(opts: EditorOptions = {}) {
    this.options = { dragDistanceSquared: opts.dragDistanceSquared ?? DRAG_DISTANCE_SQUARED };
    this.store.listen(() => this.emitChange());
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
  }

  registerToolDefinition(toolDefinition: ToolDefinition): void {
    for (const stateConstructor of toolDefinition.stateConstructors) {
      this.tools.registerState(new stateConstructor(this.toolStateContext, this));
    }
    this.tools.registerTool(toolDefinition.id, toolDefinition.initialStateId);
  }

  private getDefaultToolDefinitions(): ToolDefinition[] {
    return [
      { id: 'pen', initialStateId: PenIdleState.id, stateConstructors: [PenIdleState, PenDrawingState] },
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
  setCurrentDrawStyle(partial: Partial<{ color: ColorStyle; dash: DashStyle; size: SizeStyle }>) {
    this.drawStyle = { ...this.drawStyle, ...partial };
    this.emitChange();
  }

  setViewport(partial: Partial<Viewport>) {
    this.viewport = {
      x: partial.x ?? this.viewport.x,
      y: partial.y ?? this.viewport.y,
      zoom: partial.zoom ?? this.viewport.zoom,
    };
    this.emitChange();
  }

  panBy(dx: number, dy: number) {
    this.setViewport({
      x: this.viewport.x + dx,
      y: this.viewport.y + dy,
    });
  }

  getDocumentSnapshot(): TsdrawDocumentSnapshot {
    return {
      records: documentSnapshotToRecords(this.store.getSnapshot()),
    };
  }

  loadDocumentSnapshot(snapshot: TsdrawDocumentSnapshot): void {
    const documentSnapshot = recordsToDocumentSnapshot(snapshot.records);
    if (!documentSnapshot) return;
    this.store.loadSnapshot(documentSnapshot);
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
    this.setCurrentDrawStyle(snapshot.drawStyle);
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

  listen(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
}
