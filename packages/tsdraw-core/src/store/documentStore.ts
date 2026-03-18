import type { PageState, Shape, ShapeId } from '../types.js';
import { STROKE_WIDTHS } from '../types.js';
import { decodePathToPoints } from '../utils/pathCodec.js';
import type { DocumentStoreSnapshot } from '../persistence/snapshots.js';

type DocumentStoreListener = () => void;

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

// In-memory document store for current page
export class DocumentStore {
  private state: PageState = {
    id: 'page-1',
    shapes: {},
    erasingShapeIds: [],
  };
  private order: ShapeId[] = [];
  private readonly listeners = new Set<DocumentStoreListener>();

  getPage(): PageState {
    return this.state;
  }

  getShape(id: ShapeId): Shape | undefined {
    return this.state.shapes[id];
  }

  // Shapes organised in sorted order (first at bottom)
  getCurrentPageShapesSorted(): Shape[] {
    const list = this.order.length > 0 ? this.order : Object.keys(this.state.shapes);
    return list
      .map((id) => this.state.shapes[id])
      .filter((s): s is Shape => s != null);
  }

  // Shapes in reverse order (topmost first) for hit-testing
  getCurrentPageRenderingShapesSorted(): Shape[] {
    return [...this.getCurrentPageShapesSorted()].reverse();
  }

  getErasingShapeIds(): ShapeId[] {
    return [...this.state.erasingShapeIds];
  }

  setErasingShapes(ids: ShapeId[]): void {
    this.state.erasingShapeIds = ids;
    this.emitChange();
  }

  createShape(shape: Shape): void {
    this.state.shapes[shape.id] = shape;
    this.order.push(shape.id);
    this.emitChange();
  }

  updateShape(id: ShapeId, partial: Partial<Shape>): void {
    const existing = this.state.shapes[id];
    if (!existing) return;
    this.state.shapes[id] = { ...existing, ...partial, id };
    this.emitChange();
  }

  deleteShapes(ids: ShapeId[]): void {
    for (const id of ids) {
      delete this.state.shapes[id];
      this.order = this.order.filter((i) => i !== id);
    }
    this.state.erasingShapeIds = this.state.erasingShapeIds.filter((i) => !ids.includes(i));
    this.emitChange();
  }

  getCurrentPageShapes(): Shape[] {
    return Object.values(this.state.shapes);
  }

  // Shape IDs whose bounds intersect the given box for eraser line-segment hit
  getShapeIdsInBounds(box: { minX: number; minY: number; maxX: number; maxY: number }): Set<ShapeId> {
    const ids = new Set<ShapeId>();
    for (const shape of this.getCurrentPageShapesSorted()) {
      const b = getShapeBounds(shape);
      if (
        b.maxX >= box.minX &&
        b.minX <= box.maxX &&
        b.maxY >= box.minY &&
        b.minY <= box.maxY
      ) {
        ids.add(shape.id);
      }
    }
    return ids;
  }

  getSnapshot(): DocumentStoreSnapshot {
    return {
      page: cloneValue(this.state),
      order: [...this.order],
    };
  }

  // Load snapshot into the document when loading a persistence snapshot (so on page reload)
  loadSnapshot(snapshot: DocumentStoreSnapshot): void {
    const pageState = cloneValue(snapshot.page);
    const normalizedOrder = [...snapshot.order].filter((shapeId) => pageState.shapes[shapeId] != null);
    this.state = {
      id: pageState.id,
      shapes: pageState.shapes,
      erasingShapeIds: pageState.erasingShapeIds.filter((shapeId) => pageState.shapes[shapeId] != null),
    };
    this.order = normalizedOrder;
    this.emitChange();
  }

  listen(listener: DocumentStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function getShapeBounds(shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (shape.type !== 'draw') {
    return { minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y };
  }
  const pts = decodePathToPoints(shape.props.segments, shape.x, shape.y);
  if (pts.length === 0) return { minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y };
  let minX = pts[0]!.x;
  let minY = pts[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const stroke = STROKE_WIDTHS[shape.props.size] * shape.props.scale;
  return { minX: minX - stroke, minY: minY - stroke, maxX: maxX + stroke, maxY: maxY + stroke };
}
