import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';

type VerticalPart = 'top' | 'bottom' | 'center';
type HorizontalPart = 'left' | 'right' | 'center';
export type UiAnchor = | `${VerticalPart}-${HorizontalPart}` | `${HorizontalPart}-${VerticalPart}`;

export interface TsdrawUiPlacement {
  anchor?: UiAnchor;
  edgeOffset?: number;
  style?: CSSProperties;
}

export interface ComponentDragEndPayload {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface DraggedPosition {
  anchor: UiAnchor;
}

export interface BaseComponentProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
  onDragEnd?: (payload: ComponentDragEndPayload) => void;
  'aria-label'?: string;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  didDrag: boolean;
  isDragging: boolean;
}

export type ComponentOrientation = 'horizontal' | 'vertical';

export function parseAnchor(anchor: UiAnchor): { vertical: VerticalPart; horizontal: HorizontalPart } {
  const parts = anchor.split('-') as string[];
  let vertical: VerticalPart = 'center';
  let horizontal: HorizontalPart = 'center';
  for (const part of parts) {
    if (part === 'top' || part === 'bottom') vertical = part;
    else if (part === 'left' || part === 'right') horizontal = part;
  }
  return { vertical, horizontal };
}

// Depending on the anchor and edge offset, return the style to apply to the component
export function resolvePlacementStyle(placement: TsdrawUiPlacement | undefined, fallbackAnchor: UiAnchor, fallbackEdgeOffset: number): CSSProperties {
  const anchor = placement?.anchor ?? fallbackAnchor;
  const edgeOffset = placement?.edgeOffset ?? fallbackEdgeOffset;
  const { vertical, horizontal } = parseAnchor(anchor);
  const result: CSSProperties = {};
  const transforms: string[] = [];

  if (horizontal === 'left') {
    result.left = edgeOffset;
  } else if (horizontal === 'right') {
    result.right = edgeOffset;
  } else {
    result.left = '50%';
    transforms.push('translateX(-50%)');
  }

  if (vertical === 'top') {
    result.top = edgeOffset;
  } else if (vertical === 'bottom') {
    result.bottom = edgeOffset;
  } else {
    result.top = '50%';
    transforms.push('translateY(-50%)');
  }

  if (transforms.length > 0) result.transform = transforms.join(' ');

  return placement?.style ? { ...result, ...placement.style } : result;
}

export function resolveOrientation(anchor: UiAnchor): ComponentOrientation {
  const { vertical, horizontal } = parseAnchor(anchor);
  if ((horizontal === 'left' || horizontal === 'right') && vertical === 'center') return 'vertical';
  return 'horizontal';
}

const SNAP_TARGETS: Array<{ anchor: UiAnchor; nx: number; ny: number }> = [
  { anchor: 'top-center', nx: 0.5, ny: 0 },
  { anchor: 'bottom-center', nx: 0.5, ny: 1 },
  { anchor: 'left-center', nx: 0, ny: 0.5 },
  { anchor: 'right-center', nx: 1, ny: 0.5 },
  { anchor: 'top-left', nx: 0, ny: 0 },
  { anchor: 'top-right', nx: 1, ny: 0 },
  { anchor: 'bottom-left', nx: 0, ny: 1 },
  { anchor: 'bottom-right', nx: 1, ny: 1 },
];

// Calculate the closest anchor to the dragged position
export function calculateSnap(payload: ComponentDragEndPayload, containerRect: DOMRect, disabledPositions?: Set<UiAnchor>): DraggedPosition {
  const nx = Math.max(0, Math.min(1, (payload.centerX - containerRect.left) / containerRect.width));
  const ny = Math.max(0, Math.min(1, (payload.centerY - containerRect.top) / containerRect.height));

  let closestAnchor: UiAnchor = 'bottom-center';
  let closestDistSq = Infinity;

  for (const target of SNAP_TARGETS) {
    if (disabledPositions && disabledPositions.has(target.anchor)) continue;
    const dx = nx - target.nx;
    const dy = ny - target.ny;
    const distSq = dx * dx + dy * dy;
    if (distSq < closestDistSq) {
      closestDistSq = distSq;
      closestAnchor = target.anchor;
    }
  }

  return { anchor: closestAnchor };
}

export function BaseComponent({ children, className, style, draggable = false, onDragEnd, 'aria-label': ariaLabel }: BaseComponentProps) {
  const componentRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const pendingSnapRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  useLayoutEffect(() => {
    if (!pendingSnapRef.current) return;
    const componentNode = componentRef.current;
    if (componentNode) componentNode.style.translate = '';
    pendingSnapRef.current = false;
    setIsDragging(false);
  });

  const finishDrag = (event: PointerEvent<HTMLDivElement>, shouldSnap: boolean) => {
    const componentNode = componentRef.current;
    const dragState = dragStateRef.current;
    if (!componentNode || !dragState || dragState.pointerId !== event.pointerId) return;

    if (componentNode.hasPointerCapture(event.pointerId)) {
      componentNode.releasePointerCapture(event.pointerId);
    }

    if (dragState.isDragging && shouldSnap && onDragEnd) {
      const rect = componentNode.getBoundingClientRect();
      onDragEnd({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + (rect.width / 2),
        centerY: rect.top + (rect.height / 2),
      });
      pendingSnapRef.current = true;
    } else {
      componentNode.style.translate = '';
      setIsDragging(false);
    }

    suppressClickRef.current = dragState.didDrag;
    dragStateRef.current = null;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggable || event.button !== 0) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      didDrag: false,
      isDragging: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const componentNode = componentRef.current;
    const dragState = dragStateRef.current;
    if (!draggable || !componentNode || !dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (!dragState.isDragging && ((deltaX * deltaX) + (deltaY * deltaY)) >= 25) {
      dragState.isDragging = true;
      dragState.didDrag = true;
      componentNode.setPointerCapture(event.pointerId);
      setIsDragging(true);
    }

    if (dragState.isDragging) {
      componentNode.style.translate = `${deltaX}px ${deltaY}px`;
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    finishDrag(event, true);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    finishDrag(event, false);
  };

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!draggable || !suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const draggableClass = draggable ? ' tsdraw-component--draggable' : '';
  const draggingClass = isDragging ? ' tsdraw-component--dragging' : '';

  return (
    <div
      ref={componentRef}
      className={`tsdraw-component${draggableClass}${draggingClass}${className ? ` ${className}` : ''}`}
      style={style}
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
    >
      {children}
    </div>
  );
}
