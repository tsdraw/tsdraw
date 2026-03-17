import { DocumentStore } from '../store/documentStore.js';
import type { Viewport } from '../canvas/viewport.js';
import { createViewport, screenToPage } from '../canvas/viewport.js';
import { CanvasRenderer } from '../canvas/renderer.js';
import { InputManager } from '../input/inputManager.js';
import { ToolManager, type ToolId } from '../tools/toolManager.js';
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

export interface EditorOptions {
  dragDistanceSquared?: number;
}

let shapeIdCounter = 0;
function createShapeId(): ShapeId {
  return `shape:${String(++shapeIdCounter).padStart(6, '0')}`;
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

  constructor(opts: EditorOptions = {}) {
    this.options = { dragDistanceSquared: opts.dragDistanceSquared ?? DRAG_DISTANCE_SQUARED };
    const ctx = { transition: (id: string, info?: unknown) => this.tools.transition(id, info) };
    this.tools.registerState(new PenIdleState(ctx, this));
    this.tools.registerState(new PenDrawingState(ctx, this));
    this.tools.registerState(new EraserIdleState(ctx, this));
    this.tools.registerState(new EraserPointingState(ctx, this));
    this.tools.registerState(new EraserErasingState(ctx, this));
    this.tools.registerState(new SelectIdleState(ctx, this));
    this.tools.registerState(new HandIdleState(ctx, this));
    this.tools.registerState(new HandDraggingState(ctx, this));
    this.tools.setCurrentTool('pen');
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

  setCurrentTool(id: ToolId) { this.tools.setCurrentTool(id); }
  getCurrentToolId(): ToolId { return this.tools.getCurrentToolId(); }

  getCurrentDrawStyle() { return { ...this.drawStyle }; }
  setCurrentDrawStyle(partial: Partial<{ color: ColorStyle; dash: DashStyle; size: SizeStyle }>) { this.drawStyle = { ...this.drawStyle, ...partial }; }
  
  panBy(dx: number, dy: number) {
    this.viewport.x += dx;
    this.viewport.y += dy;
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
}
