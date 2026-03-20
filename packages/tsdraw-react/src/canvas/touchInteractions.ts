import type { Editor } from '@tsdraw/core';

const TAP_MAX_DURATION_MS = 100; // the max time of a tap gesture
const DOUBLE_TAP_INTERVAL_MS = 100; // the min time between double taps
const TAP_MOVE_TOLERANCE = 14; // the min distance user can move their finger to register as a tap
const PINCH_MODE_ZOOM_DISTANCE = 24; // the min distance user can pinch to zoom the camera
const PINCH_MODE_PAN_DISTANCE = 16; // the min distance user can pinch to pan the camera
const PINCH_MODE_SWITCH_TO_ZOOM_DISTANCE = 64; // the min distance user can pinch to switch from panning to zooming

type TouchCameraMode = 'not-sure' | 'zooming' | 'panning';

interface TouchTapState {
  active: boolean;
  startTime: number;
  maxTouchCount: number;
  moved: boolean;
  startPoints: Map<number, { x: number; y: number }>;
  lastTapAtByCount: Partial<Record<2 | 3, number>>;
}

interface TouchCameraState {
  active: boolean;
  mode: TouchCameraMode;
  previousCenter: { x: number; y: number };
  initialCenter: { x: number; y: number };
  previousDistance: number;
  initialDistance: number;
  previousAngle: number;
}

export interface TouchInteractionHandlers {
  cancelActivePointerInteraction: () => void;
  refreshView: () => void;
  runUndo: () => boolean;
  runRedo: () => boolean;
}

export interface TouchInteractionController {
  handlePointerDown: (event: PointerEvent) => boolean;
  handlePointerMove: (event: PointerEvent) => boolean;
  handlePointerUpOrCancel: (event: PointerEvent) => boolean;
  handleGestureEvent: (event: Event, container: HTMLElement) => void;
  reset: () => void;
  isCameraGestureActive: () => boolean;
  isTrackpadZoomActive: () => boolean;
}

export function createTouchInteractionController(
  editor: Editor,
  canvas: HTMLCanvasElement,
  handlers: TouchInteractionHandlers
): TouchInteractionController {
  const activeTouchPoints = new Map<number, { x: number; y: number }>();
  const touchTapState: TouchTapState = {
    active: false,
    startTime: 0,
    maxTouchCount: 0,
    moved: false,
    startPoints: new Map(),
    lastTapAtByCount: {},
  };
  const touchCameraState: TouchCameraState = {
    active: false,
    mode: 'not-sure',
    previousCenter: { x: 0, y: 0 },
    initialCenter: { x: 0, y: 0 },
    previousDistance: 1,
    initialDistance: 1,
    previousAngle: 0,
  };

  const isTouchPointer = (event: PointerEvent) => event.pointerType === 'touch';

  const endTouchCameraGesture = () => {
    touchCameraState.active = false;
    touchCameraState.mode = 'not-sure';
    touchCameraState.previousDistance = 1;
    touchCameraState.initialDistance = 1;
    touchCameraState.previousAngle = 0;
  };

  const maybeHandleTouchTapGesture = () => {
    if (activeTouchPoints.size > 0) return;
    if (!touchTapState.active) return;

    const elapsed = performance.now() - touchTapState.startTime;
    if (!touchTapState.moved && elapsed <= TAP_MAX_DURATION_MS && (touchTapState.maxTouchCount === 2 || touchTapState.maxTouchCount === 3)) {
      const fingerCount = touchTapState.maxTouchCount as 2 | 3;
      const now = performance.now();
      const previousTapTime = touchTapState.lastTapAtByCount[fingerCount] ?? 0;
      const isDoubleTap = previousTapTime > 0 && now - previousTapTime <= DOUBLE_TAP_INTERVAL_MS;
            if (isDoubleTap) {
              touchTapState.lastTapAtByCount[fingerCount] = 0;
              if (fingerCount === 2) {
                if (handlers.runUndo()) handlers.refreshView();
              } else if (handlers.runRedo()) handlers.refreshView();
          } else touchTapState.lastTapAtByCount[fingerCount] = now;
    }

    touchTapState.active = false;
    touchTapState.startPoints.clear();
    touchTapState.maxTouchCount = 0;
    touchTapState.moved = false;
  };

  const beginTouchCameraGesture = () => {
    const points = [...activeTouchPoints.values()];
    if (points.length !== 2) return;

    handlers.cancelActivePointerInteraction();
    const first = points[0]!;
    const second = points[1]!;
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const angle = Math.atan2(second.y - first.y, second.x - first.x);

    touchCameraState.active = true;
    touchCameraState.mode = 'not-sure';
    touchCameraState.previousCenter = center;
    touchCameraState.initialCenter = center;
    touchCameraState.previousDistance = Math.max(1, distance);
    touchCameraState.initialDistance = Math.max(1, distance);
    touchCameraState.previousAngle = angle;
  };

  const updateTouchCameraGesture = () => {
    if (!touchCameraState.active) return false;
    const points = [...activeTouchPoints.values()];
    if (points.length !== 2) {
      endTouchCameraGesture();
      return false;
    }

    const first = points[0]!;
    const second = points[1]!;
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const angle = Math.atan2(second.y - first.y, second.x - first.x);
    const centerDx = center.x - touchCameraState.previousCenter.x;
    const centerDy = center.y - touchCameraState.previousCenter.y;
    const touchDistance = Math.abs(distance - touchCameraState.initialDistance);
    const originDistance = Math.hypot(center.x - touchCameraState.initialCenter.x, center.y - touchCameraState.initialCenter.y);

    if (touchCameraState.mode === 'not-sure') {
      if (touchDistance > PINCH_MODE_ZOOM_DISTANCE) touchCameraState.mode = 'zooming';
      else if (originDistance > PINCH_MODE_PAN_DISTANCE) touchCameraState.mode = 'panning';
    } else if (touchCameraState.mode === 'panning' && touchDistance > PINCH_MODE_SWITCH_TO_ZOOM_DISTANCE) touchCameraState.mode = 'zooming';

    const canvasRect = canvas.getBoundingClientRect();
    const centerOnCanvasX = center.x - canvasRect.left;
    const centerOnCanvasY = center.y - canvasRect.top;
    editor.panBy(centerDx, centerDy);
    if (touchCameraState.mode === 'zooming') {
      const zoomFactor = distance / touchCameraState.previousDistance;
      editor.zoomAt(zoomFactor, centerOnCanvasX, centerOnCanvasY);
      editor.rotateAt(angle - touchCameraState.previousAngle, centerOnCanvasX, centerOnCanvasY);
    }

    touchCameraState.previousCenter = center;
    touchCameraState.previousDistance = distance;
    touchCameraState.previousAngle = angle;
    handlers.refreshView();
    return true;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!isTouchPointer(event)) return false;

    activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!touchTapState.active) {
      touchTapState.active = true;
      touchTapState.startTime = performance.now();
      touchTapState.maxTouchCount = activeTouchPoints.size;
      touchTapState.moved = false;
      touchTapState.startPoints.clear();
    } else {
      touchTapState.maxTouchCount = Math.max(touchTapState.maxTouchCount, activeTouchPoints.size);
    }
    touchTapState.startPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activeTouchPoints.size === 2) {
      beginTouchCameraGesture();
      return true;
    }

    return false;
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!isTouchPointer(event)) return false;
    if (activeTouchPoints.has(event.pointerId)) activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    
    const tapStart = touchTapState.startPoints.get(event.pointerId);
    if (tapStart) {
      const moved = Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y);
      if (moved > TAP_MOVE_TOLERANCE) touchTapState.moved = true;
    }
    return updateTouchCameraGesture();
  };

  const handlePointerUpOrCancel = (event: PointerEvent) => {
    if (!isTouchPointer(event)) return false;
    const wasCameraGestureActive = touchCameraState.active;
    activeTouchPoints.delete(event.pointerId);
    touchTapState.startPoints.delete(event.pointerId);
    if (activeTouchPoints.size < 2) endTouchCameraGesture();
    maybeHandleTouchTapGesture();
    return wasCameraGestureActive;
  };

  let gestureLastScale = 1;
  let gestureActive = false;

  const handleGestureEvent = (event: Event, container: HTMLElement) => {
    if (!container.contains(event.target as Node)) return;
    event.preventDefault();

    const gestureEvent = event as Event & { scale?: number; clientX?: number; clientY?: number };
    if (gestureEvent.scale == null) return;

    if (event.type === 'gesturestart') {
      gestureLastScale = gestureEvent.scale;
      gestureActive = true;
      return;
    }

    if (event.type === 'gestureend') {
      gestureActive = false;
      gestureLastScale = 1;
      return;
    }

    if (event.type === 'gesturechange' && gestureActive) {
      const zoomFactor = gestureEvent.scale / gestureLastScale;
      gestureLastScale = gestureEvent.scale;
      const canvasRect = canvas.getBoundingClientRect();
      const cx = (gestureEvent.clientX ?? canvasRect.left + canvasRect.width / 2) - canvasRect.left;
      const cy = (gestureEvent.clientY ?? canvasRect.top + canvasRect.height / 2) - canvasRect.top;
      editor.zoomAt(zoomFactor, cx, cy);
      handlers.refreshView();
    }
  };

  const reset = () => {
    activeTouchPoints.clear();
    touchTapState.active = false;
    touchTapState.startPoints.clear();
    endTouchCameraGesture();
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUpOrCancel,
    handleGestureEvent,
    reset,
    isCameraGestureActive: () => touchCameraState.active,
    isTrackpadZoomActive: () => gestureActive,
  };
}