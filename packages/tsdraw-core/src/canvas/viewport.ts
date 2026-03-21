// Viewport: pan (x,y) and zoom
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export function createViewport(): Viewport {
  return { x: 0, y: 0, zoom: 1 };
}

// Screen point to page point
export function screenToPage(viewport: Viewport, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  };
}

// Page point to screen point
export function pageToScreen(viewport: Viewport, pageX: number, pageY: number): { x: number; y: number } {
  return {
    x: pageX * viewport.zoom + viewport.x,
    y: pageY * viewport.zoom + viewport.y,
  };
}

export function setViewport(
  viewport: Viewport,
  updater: { x?: number; y?: number; zoom?: number }
): Viewport {
  return {
    x: updater.x ?? viewport.x,
    y: updater.y ?? viewport.y,
    zoom: updater.zoom ?? viewport.zoom,
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
  const x = centerX - pageBefore.x * zoom;
  const y = centerY - pageBefore.y * zoom;
  return { x, y, zoom };
}
