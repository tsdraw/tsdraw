import type { DocumentStore } from '../store/documentStore.js';
import type { InputManager } from '../input/inputManager.js';
import type { Viewport } from '../canvas/viewport.js';
import type { Shape, DrawShape, ShapeId, ColorStyle, DashStyle, FillStyle, SizeStyle } from '../types.js';
import type { Vec3 } from '../types.js';

export interface IEditor {
  getZoomLevel(): number;
  readonly viewport: Viewport;
  options: { dragDistanceSquared: number };
  store: DocumentStore;
  input: InputManager;
  getShape(id: ShapeId): Shape | undefined;
  createShape(shape: Shape): void;
  updateShapes(partials: Array<{ id: ShapeId; type: string; props?: Partial<DrawShape['props']> }>): void;
  getPointInShapeSpace(shape: DrawShape, pagePoint: Vec3): Vec3;
  createShapeId(): ShapeId;
  getErasingShapeIds(): ShapeId[];
  setErasingShapes(ids: ShapeId[]): void;
  getCurrentPageRenderingShapesSorted(): import('../types.js').Shape[];
  getCurrentDrawStyle(): { color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle };
  setCurrentDrawStyle(partial: Partial<{ color: ColorStyle; dash: DashStyle; fill: FillStyle; size: SizeStyle }>): void;
  setViewport(partial: Partial<Viewport>): void;
  panBy(dx: number, dy: number): void;
  beginHistoryEntry(): void;
  endHistoryEntry(): void;
  requestRender(): void;
}
