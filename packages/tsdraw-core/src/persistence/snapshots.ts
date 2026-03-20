import type { DashStyle, DrawShape, PageState, Shape, ShapeId, SizeStyle, ColorStyle, FillStyle } from '../types.js';

export interface TsdrawPageRecord {
  id: string;
  typeName: 'page';
  pageId: string;
  shapeIds: ShapeId[];
  erasingShapeIds: ShapeId[];
}

export interface TsdrawShapeRecord {
  id: ShapeId;
  typeName: 'shape';
  shape: Shape;
}

export type TsdrawPersistedRecord = TsdrawPageRecord | TsdrawShapeRecord;

export interface TsdrawDocumentSnapshot {
  records: TsdrawPersistedRecord[];
}

export interface TsdrawSessionStateSnapshot {
  version: 1;
  viewport: {
    x: number;
    y: number;
    zoom: number;
    rotation?: number;
  };
  currentToolId: string;
  drawStyle: {
    color: ColorStyle;
    dash: DashStyle;
    fill?: FillStyle;
    size: SizeStyle;
  };
  selectedShapeIds: ShapeId[];
}

export interface TsdrawEditorSnapshot {
  document: TsdrawDocumentSnapshot;
  state: TsdrawSessionStateSnapshot;
}

export interface TsdrawHistorySnapshot {
  version: 1;
  undoStack: TsdrawDocumentSnapshot[];
  redoStack: TsdrawDocumentSnapshot[];
}

export interface DocumentStoreSnapshot {
  page: PageState;
  order: ShapeId[];
}

const PAGE_RECORD_ID = 'page:current';

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function asDrawShape(value: Shape): DrawShape {
  return cloneValue(value as DrawShape);
}

export function documentSnapshotToRecords(snapshot: DocumentStoreSnapshot): TsdrawPersistedRecord[] {
  const shapeIds = [...snapshot.order].filter((id) => snapshot.page.shapes[id] != null);
  const pageRecord: TsdrawPageRecord = {
    id: PAGE_RECORD_ID,
    typeName: 'page',
    pageId: snapshot.page.id,
    shapeIds,
    erasingShapeIds: [...snapshot.page.erasingShapeIds],
  };
  const shapeRecords: TsdrawShapeRecord[] = shapeIds
    .map((shapeId) => snapshot.page.shapes[shapeId])
    .filter((shape): shape is Shape => shape != null)
    .map((shape) => ({
      id: shape.id,
      typeName: 'shape',
      shape: asDrawShape(shape),
    }));

  return [pageRecord, ...shapeRecords];
}

export function recordsToDocumentSnapshot(records: TsdrawPersistedRecord[]): DocumentStoreSnapshot | null {
  const pageRecord = records.find((record): record is TsdrawPageRecord => record.typeName === 'page');
  if (!pageRecord) {
    return null;
  }

  const shapeRecordMap = new Map<string, TsdrawShapeRecord>();
  for (const record of records) {
    if (record.typeName === 'shape') {
      shapeRecordMap.set(record.id, record);
    }
  }

  const shapes: Record<ShapeId, Shape> = {};
  const order: ShapeId[] = [];

  for (const shapeId of pageRecord.shapeIds) {
    const shapeRecord = shapeRecordMap.get(shapeId);
    if (!shapeRecord) continue;
    shapes[shapeId] = asDrawShape(shapeRecord.shape);
    order.push(shapeId);
  }

  return {
    page: {
      id: pageRecord.pageId,
      shapes,
      erasingShapeIds: [...pageRecord.erasingShapeIds].filter((shapeId) => shapes[shapeId] != null),
    },
    order,
  };
}
