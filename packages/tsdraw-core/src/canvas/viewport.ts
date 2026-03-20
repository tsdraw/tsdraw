// Viewport: pan (x,y) and zoom
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export function createViewport(): Viewport {
  return { x: 0, y: 0, zoom: 1, rotation: 0 };
}

// Screen point to page point
export function screenToPage(viewport: Viewport, screenX: number, screenY: number): { x: number; y: number } {
  const tx = screenX - viewport.x;
  const ty = screenY - viewport.y;
  const cos = Math.cos(viewport.rotation);
  const sin = Math.sin(viewport.rotation);
  return {
    x: (tx * cos + ty * sin) / viewport.zoom,
    y: (-tx * sin + ty * cos) / viewport.zoom,
  };
}

// Page point to screen point
export function pageToScreen(viewport: Viewport, pageX: number, pageY: number): { x: number; y: number } {
  const scaledX = pageX * viewport.zoom;
  const scaledY = pageY * viewport.zoom;
  const cos = Math.cos(viewport.rotation);
  const sin = Math.sin(viewport.rotation);
  return {
    x: scaledX * cos - scaledY * sin + viewport.x,
    y: scaledX * sin + scaledY * cos + viewport.y,
  };
}

export function setViewport(
  viewport: Viewport,
  updater: { x?: number; y?: number; zoom?: number; rotation?: number }
): Viewport {
  return {
    x: updater.x ?? viewport.x,
    y: updater.y ?? viewport.y,
    zoom: updater.zoom ?? viewport.zoom,
    rotation: updater.rotation ?? viewport.rotation,
  };
}

export function panViewport(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

export function zoomViewport(viewport: Viewport, factor: number, centerX?: number, centerY?: number): Viewport {
  const zoom = Math.max(0.1, Math.min(4, viewport.zoom * factor));
  if (centerX == null || centerY == null) {
    return { ...viewport, zoom };
  }
  const pageBefore = screenToPage(viewport, centerX, centerY);
  const cos = Math.cos(viewport.rotation);
  const sin = Math.sin(viewport.rotation);
  const x = centerX - (pageBefore.x * zoom * cos - pageBefore.y * zoom * sin);
  const y = centerY - (pageBefore.x * zoom * sin + pageBefore.y * zoom * cos);
  return { x, y, zoom, rotation: viewport.rotation };
}

export function rotateViewport(viewport: Viewport, delta: number, centerX?: number, centerY?: number): Viewport {
  const rotation = viewport.rotation + delta;
  if (centerX == null || centerY == null) {
    return { ...viewport, rotation };
  }
  const pageBefore = screenToPage(viewport, centerX, centerY);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const x = centerX - (pageBefore.x * viewport.zoom * cos - pageBefore.y * viewport.zoom * sin);
  const y = centerY - (pageBefore.x * viewport.zoom * sin + pageBefore.y * viewport.zoom * cos);
  return { x, y, zoom: viewport.zoom, rotation };
}
